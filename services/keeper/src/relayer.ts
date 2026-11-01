/**
 * Testnet NEP-366 relayer.
 *
 * Security model:
 *   - The relayer pays gas from its own account.
 *   - It only accepts a delegate with exactly one `charge` FunctionCall to the
 *     configured Tab Vault, with zero attached deposit.
 *   - The delegate must be signed by an Ed25519 Function-Call access key on
 *     the sender account, scoped to `<vault>::charge`. A FullAccess key is
 *     rejected before the relayer spends any gas.
 *   - The delegate is verified locally, then the chain verifies it again.
 *   - Rate limited per sender; the relayer key never leaves the server.
 */
import * as nearAPI from 'near-api-js';
import {
  actionCreators,
  DelegateAction,
  encodeDelegateAction,
  SignedDelegate,
  Signature,
} from '@near-js/transactions';
import { sha256 } from '@noble/hashes/sha256';
import { RelayUsageStore } from './usage.js';

const { connect, keyStores, KeyPair, providers } = nearAPI;

export interface RelayerConfig {
  network: string;
  rpc: string;
  vaultId: string;
  tokenId: string;
  relayerAccountId?: string;
  relayerPrivateKey?: string;
  maxGas: bigint;
  maxBlockWindow: number;
  rateLimitPerMinute: number;
}

export type RelayOutcome = {
  status: 'executed' | 'rejected' | 'failed' | 'submitted';
  reason?: string;
  txHash: string;
  explorerUrl: string;
  senderId: string;
  relayer: string;
  tabId: number;
  nonce: number;
  event?: any;
  gasPaidBy: 'relayer';
  gasCostYocto?: string;
};

export class RelayError extends Error {
  status: number;
  code: string;
  details?: any;

  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface SignedDelegateJson {
  senderId: string;
  receiverId: string;
  actions: Array<{
    functionCall: {
      methodName: string;
      args: string;
      gas: string;
      deposit: string;
    };
  }>;
  nonce: number;
  maxBlockHeight: number;
  publicKey: string;
  signature: string;
}

const ACCOUNT_ID_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const MAX_REFERENCE_LEN = 128;

function isValidAccountId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.length <= 64 &&
    ACCOUNT_ID_RE.test(value)
  );
}

function parseInteger(value: unknown, name: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new RelayError(400, 'INVALID_DELEGATE', `${name} must be a non-negative safe integer.`);
  }
  return n;
}

function decodeArgs(base64: string): any {
  if (typeof base64 !== 'string' || base64.length > 4096) {
    throw new RelayError(400, 'INVALID_DELEGATE', 'FunctionCall args must be a small base64 string.');
  }
  let raw: string;
  try {
    raw = Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    throw new RelayError(400, 'INVALID_DELEGATE', 'FunctionCall args are not valid base64.');
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new RelayError(400, 'INVALID_DELEGATE', 'FunctionCall args must be a JSON object.');
  }
}

export class RelayerService {
  private config: RelayerConfig;
  private provider: nearAPI.providers.JsonRpcProvider;
  private connection: nearAPI.Near | null = null;
  private account: nearAPI.Account | null = null;
  private recent = new Map<string, number[]>();
  private usage: RelayUsageStore;

  constructor(
    config: Partial<RelayerConfig> = {},
    usage?: RelayUsageStore
  ) {
    this.config = {
      network: config.network || process.env.NEAR_NETWORK || 'testnet',
      rpc: config.rpc || process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com',
      vaultId: config.vaultId || process.env.TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet',
      tokenId: config.tokenId || process.env.TAB_TOKEN_ID || 'tab-usdc.testnet',
      relayerAccountId:
        config.relayerAccountId || process.env.RELAYER_ACCOUNT_ID,
      relayerPrivateKey:
        config.relayerPrivateKey || process.env.RELAYER_PRIVATE_KEY,
      maxGas: config.maxGas || BigInt(process.env.RELAYER_MAX_GAS || '100000000000000'),
      maxBlockWindow: config.maxBlockWindow || Number(process.env.RELAYER_MAX_BLOCK_WINDOW || 200),
      rateLimitPerMinute:
        config.rateLimitPerMinute || Number(process.env.RELAYER_RATE_LIMIT || 10),
    };
    this.usage = usage || new RelayUsageStore();
    this.provider = new providers.JsonRpcProvider({ url: this.config.rpc });
  }

  get enabled(): boolean {
    return Boolean(this.config.relayerAccountId && this.config.relayerPrivateKey);
  }

  get relayerAccountId(): string | null {
    return this.config.relayerAccountId || null;
  }

  async init(): Promise<void> {
    if (!this.enabled) return;
    if (this.account) return;
    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(
      this.config.network,
      this.config.relayerAccountId!,
      KeyPair.fromString(this.config.relayerPrivateKey as never)
    );
    this.connection = await connect({
      networkId: this.config.network,
      nodeUrl: this.config.rpc,
      keyStore,
    });
    this.account = await this.connection.account(this.config.relayerAccountId!);
  }

  async status(): Promise<any> {
    if (!this.enabled) {
      return {
        enabled: false,
        network: this.config.network,
        relayer: null,
        relayerBalanceYocto: null,
        vault: this.config.vaultId,
        token: this.config.tokenId,
        maxGas: this.config.maxGas.toString(),
      };
    }
    await this.init();
    const state = await this.account!.state();
    return {
      enabled: true,
      network: this.config.network,
      relayer: this.config.relayerAccountId,
      relayerBalanceYocto: state.amount,
      vault: this.config.vaultId,
      token: this.config.tokenId,
      maxGas: this.config.maxGas.toString(),
    };
  }

  /**
   * Actual gas metered per sender. This is the foundation for prepaid
   * relayer credits; it is not a contract fee and never touches user funds.
   */
  usageReport(): {
    totals: { relays: number; tokensBurntYocto: string; senders: number };
    senders: any[];
  } {
    return {
      totals: this.usage.totals(),
      senders: this.usage.all(),
    };
  }

  private rateLimit(senderId: string) {
    const now = Date.now();
    const windowStart = now - 60_000;
    const hits = (this.recent.get(senderId) || []).filter((t) => t > windowStart);
    if (hits.length >= this.config.rateLimitPerMinute) {
      throw new RelayError(
        429,
        'RATE_LIMITED',
        `Relayer rate limit reached for ${senderId}; retry in a minute.`
      );
    }
    hits.push(now);
    this.recent.set(senderId, hits);
  }

  private parseDelegate(input: any): SignedDelegateJson {
    if (!input || typeof input !== 'object') {
      throw new RelayError(400, 'INVALID_DELEGATE', 'signedDelegate must be an object.');
    }
    const senderId = input.senderId;
    const receiverId = input.receiverId;
    if (!isValidAccountId(senderId)) {
      throw new RelayError(400, 'INVALID_DELEGATE', 'senderId is not a valid NEAR account.');
    }
    if (!isValidAccountId(receiverId)) {
      throw new RelayError(400, 'INVALID_DELEGATE', 'receiverId is not a valid NEAR account.');
    }
    if (receiverId !== this.config.vaultId) {
      throw new RelayError(
        403,
        'INVALID_RECEIVER',
        `The relayer only relays calls to ${this.config.vaultId}.`
      );
    }
    if (!Array.isArray(input.actions) || input.actions.length !== 1) {
      throw new RelayError(
        400,
        'INVALID_DELEGATE',
        'The relayer only accepts exactly one FunctionCall action.'
      );
    }
    const fc = input.actions[0]?.functionCall;
    if (!fc || typeof fc !== 'object') {
      throw new RelayError(400, 'INVALID_DELEGATE', 'The action must be a FunctionCall.');
    }
    if (fc.methodName !== 'charge') {
      throw new RelayError(
        403,
        'METHOD_NOT_ALLOWED',
        'The relayer only relays the `charge` method.'
      );
    }
    let gas: bigint;
    let deposit: bigint;
    try {
      gas = BigInt(fc.gas);
      deposit = BigInt(fc.deposit);
    } catch {
      throw new RelayError(400, 'INVALID_GAS', 'gas and deposit must be integer strings.');
    }
    if (gas <= 0n || gas > this.config.maxGas) {
      throw new RelayError(
        400,
        'INVALID_GAS',
        `Gas must be between 1 and ${this.config.maxGas.toString()}.`
      );
    }
    if (deposit !== 0n) {
      throw new RelayError(400, 'INVALID_DEPOSIT', 'The delegate must not attach a deposit.');
    }

    const args = decodeArgs(fc.args);
    const allowedKeys = new Set(['tab_id', 'amount', 'receiver_id', 'reference', 'nonce']);
    for (const key of Object.keys(args)) {
      if (!allowedKeys.has(key)) {
        throw new RelayError(400, 'INVALID_ARGS', `Unexpected charge argument: ${key}`);
      }
    }
    const tabId = parseInteger(args.tab_id, 'tab_id');
    if (tabId <= 0) {
      throw new RelayError(400, 'INVALID_ARGS', 'tab_id must be positive.');
    }
    const amount = String(args.amount);
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      throw new RelayError(400, 'INVALID_ARGS', 'amount must be a positive integer.');
    }
    if (!isValidAccountId(args.receiver_id)) {
      throw new RelayError(400, 'INVALID_ARGS', 'receiver_id is not a valid NEAR account.');
    }
    if (typeof args.reference !== 'string' || args.reference.length > MAX_REFERENCE_LEN) {
      throw new RelayError(
        400,
        'INVALID_ARGS',
        `reference must be a string of at most ${MAX_REFERENCE_LEN} characters.`
      );
    }
    const tabNonce = parseInteger(args.nonce, 'nonce');
    const nonce = parseInteger(input.nonce, 'delegate nonce');
    const maxBlockHeight = parseInteger(input.maxBlockHeight, 'maxBlockHeight');
    if (typeof input.publicKey !== 'string' || !input.publicKey.startsWith('ed25519:')) {
      throw new RelayError(400, 'INVALID_KEY', 'publicKey must be an Ed25519 key.');
    }
    if (typeof input.signature !== 'string' || input.signature.length > 256) {
      throw new RelayError(400, 'INVALID_SIGNATURE', 'signature must be base64.');
    }

    return {
      senderId,
      receiverId,
      actions: [
        {
          functionCall: {
            methodName: fc.methodName,
            args: fc.args,
            gas: gas.toString(),
            deposit: '0',
          },
        },
      ],
      nonce,
      maxBlockHeight,
      publicKey: input.publicKey,
      signature: input.signature,
      // The validated tab nonce is returned via a private property below.
      ...({ _tabId: tabId, _amount: amount, _receiverId: args.receiver_id, _reference: args.reference, _tabNonce: tabNonce } as any),
    };
  }

  async relay(input: any): Promise<RelayOutcome> {
    if (!this.enabled) {
      throw new RelayError(
        503,
        'RELAYER_DISABLED',
        'The NEP-366 relayer is not configured on this deployment.'
      );
    }
    await this.init();

    const delegate = this.parseDelegate(input);
    const extra = delegate as any;
    this.rateLimit(delegate.senderId);

    const height = await this.getBlockHeight();
    if (delegate.maxBlockHeight <= height) {
      throw new RelayError(
        409,
        'DELEGATE_EXPIRED',
        `maxBlockHeight ${delegate.maxBlockHeight} is not above the current height ${height}.`
      );
    }
    if (delegate.maxBlockHeight > height + this.config.maxBlockWindow) {
      throw new RelayError(
        400,
        'DELEGATE_TOO_LONG',
        `maxBlockHeight is more than ${this.config.maxBlockWindow} blocks ahead.`
      );
    }
    if (delegate.nonce > height * 1_000_000) {
      throw new RelayError(
        400,
        'DELEGATE_NONCE_TOO_LARGE',
        'Delegate nonce exceeds the protocol upper bound for this block height.'
      );
    }

    // Verify the signature before touching the access key or the chain. This
    // makes a tampered delegate fail with INVALID_SIGNATURE even when its
    // access-key nonce was already consumed.
    const publicKey = nearAPI.utils.PublicKey.fromString(delegate.publicKey);
    const signature = Buffer.from(delegate.signature, 'base64');
    if (signature.length !== 64) {
      throw new RelayError(400, 'INVALID_SIGNATURE', 'Ed25519 signatures are 64 bytes.');
    }

    const fc = delegate.actions[0].functionCall;
    const delegateAction = new DelegateAction({
      senderId: delegate.senderId,
      receiverId: delegate.receiverId,
      actions: [
        actionCreators.functionCall(
          fc.methodName,
          Buffer.from(fc.args, 'base64'),
          BigInt(fc.gas),
          BigInt(0)
        ),
      ],
      nonce: BigInt(delegate.nonce),
      maxBlockHeight: BigInt(delegate.maxBlockHeight),
      publicKey,
    });

    const message = encodeDelegateAction(delegateAction);
    const hash = new Uint8Array(sha256(message));
    if (!publicKey.verify(hash, signature)) {
      throw new RelayError(
        400,
        'INVALID_SIGNATURE',
        'The delegate signature does not match the sender key.'
      );
    }

    const accessKey = await this.getAccessKey(delegate.senderId, delegate.publicKey);
    const permission = accessKey?.permission;
    const functionCall =
      permission && typeof permission === 'object' ? permission.FunctionCall : null;
    if (
      !functionCall ||
      functionCall.receiver_id !== this.config.vaultId ||
      !Array.isArray(functionCall.method_names) ||
      !functionCall.method_names.includes('charge')
    ) {
      throw new RelayError(
        403,
        'KEY_NOT_SCOPED',
        'The delegate key must be a Function-Call key scoped to <vault>::charge.'
      );
    }
    if (Number(accessKey.nonce) >= delegate.nonce) {
      throw new RelayError(
        409,
        'DELEGATE_NONCE_INVALID',
        `Delegate nonce ${delegate.nonce} must be greater than the access-key nonce ${accessKey.nonce}.`
      );
    }

    // Cheap preflight: the contract remains authoritative for policy.
    const tab = await this.getTab(extra._tabId);
    if (!tab) {
      throw new RelayError(404, 'TAB_NOT_FOUND', `Tab #${extra._tabId} was not found.`);
    }
    if (tab.spender !== delegate.senderId) {
      throw new RelayError(
        403,
        'NOT_SPENDER',
        `Tab #${extra._tabId} does not authorize ${delegate.senderId}.`
      );
    }
    if (tab.token !== this.config.tokenId) {
      throw new RelayError(
        400,
        'WRONG_TOKEN',
        `Tab #${extra._tabId} is not denominated in ${this.config.tokenId}.`
      );
    }
    if (Number(tab.next_nonce) !== extra._tabNonce) {
      throw new RelayError(
        409,
        'TAB_NONCE_MISMATCH',
        `Tab #${extra._tabId} expects nonce ${tab.next_nonce}, got ${extra._tabNonce}.`
      );
    }

    const signed = new SignedDelegate({
      delegateAction,
      signature: new Signature({ keyType: 0, data: signature }),
    });

    try {
      // The signer pays the outer transaction and any prepaid receipts. The
      // actual NEAR balance delta is the true relayer cost after refunds;
      // per-receipt `tokens_burnt` values overstate it.
      const balanceBefore = BigInt((await this.account!.state()).amount);
      const outcome: any = await this.account!.signAndSendTransaction({
        receiverId: delegate.senderId,
        actions: [actionCreators.signedDelegate(signed)],
      });
      let balanceAfter: bigint | null = null;
      try {
        balanceAfter = BigInt((await this.account!.state()).amount);
      } catch {
        // A metering RPC failure must not turn a settled relay into an error.
      }
      const txHash = outcome?.transaction?.hash || outcome?.transaction_outcome?.id;
      const explorerUrl = `https://testnet.nearblocks.io/txns/${txHash}`;
      const event =
        this.findEvent(outcome, 'charge_executed') ||
        this.findEvent(outcome, 'charge_rejected') ||
        this.findEvent(outcome, 'charge_failed');

      let status: RelayOutcome['status'] = 'submitted';
      let reason: string | undefined;
      if (event?.event === 'charge_executed') status = 'executed';
      if (event?.event === 'charge_rejected') {
        status = 'rejected';
        reason = event.data?.reason;
      }
      if (event?.event === 'charge_failed') {
        status = 'failed';
        reason = event.data?.reason;
      }

      const gasCostYocto =
        balanceAfter !== null && balanceBefore > balanceAfter
          ? balanceBefore - balanceAfter
          : 0n;
      this.usage.record(delegate.senderId, gasCostYocto, txHash);

      return {
        status,
        reason,
        txHash,
        explorerUrl,
        senderId: delegate.senderId,
        relayer: this.config.relayerAccountId!,
        tabId: extra._tabId,
        nonce: extra._tabNonce,
        event,
        gasPaidBy: 'relayer',
        gasCostYocto: gasCostYocto.toString(),
      };
    } catch (err: any) {
      const txHash =
        err?.transaction_outcome?.id ||
        err?.transaction?.hash ||
        err?.transaction_outcome?.transaction?.hash;
      const message = String(err?.message || err);
      let code = 'RELAY_FAILED';
      if (message.includes('DelegateActionInvalidNonce') || message.includes('Nonce')) {
        code = 'DELEGATE_NONCE_INVALID';
      } else if (message.includes('DelegateActionExpired')) {
        code = 'DELEGATE_EXPIRED';
      } else if (message.includes('DelegateActionAccessKeyError')) {
        code = 'KEY_NOT_SCOPED';
      }
      throw new RelayError(
        502,
        code,
        message.slice(0, 300),
        txHash
          ? { txHash, explorerUrl: `https://testnet.nearblocks.io/txns/${txHash}` }
          : undefined
      );
    }
  }

  private async getBlockHeight(): Promise<number> {
    const block: any = await this.provider.sendJsonRpc('block', {
      finality: 'final',
    });
    return Number(block.header.height);
  }

  private async getAccessKey(accountId: string, publicKey: string): Promise<any> {
    try {
      return await this.provider.query({
        request_type: 'view_access_key',
        finality: 'final',
        account_id: accountId,
        public_key: publicKey,
      });
    } catch {
      throw new RelayError(
        403,
        'KEY_NOT_FOUND',
        `Public key ${publicKey} is not an access key on ${accountId}.`
      );
    }
  }

  private async getTab(tabId: number): Promise<any> {
    // A Tab can be created and charged in the same second. The optimistic
    // view sees the new state before finality; retry briefly for a lagging
    // RPC node. The contract remains authoritative for every policy check.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res: any = await this.provider.query({
          request_type: 'call_function',
          account_id: this.config.vaultId,
          method_name: 'get_tab',
          args_base64: Buffer.from(JSON.stringify({ tab_id: tabId })).toString(
            'base64'
          ),
          finality: 'optimistic',
        });
        return JSON.parse(Buffer.from(res.result).toString('utf8'));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return null;
  }

  private findEvent(outcome: any, name: string): any {
    for (const receipt of outcome?.receipts_outcome || []) {
      for (const log of receipt?.outcome?.logs || []) {
        if (!log.startsWith('EVENT_JSON:')) continue;
        try {
          const event = JSON.parse(log.slice('EVENT_JSON:'.length));
          if (event.event === name) return event;
        } catch {
          // ignore malformed log
        }
      }
    }
    return null;
  }
}
