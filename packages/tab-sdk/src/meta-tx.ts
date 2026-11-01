/**
 * NEP-366 meta-transaction helpers for gasless Tab charges.
 *
 * The sender (merchant or AI agent) signs a `DelegateAction` off-chain with a
 * Function-Call access key scoped to `<vault>::charge`. A relayer submits the
 * signed delegate in a transaction and pays the NEAR gas. The sender needs no
 * NEAR and never exposes a FullAccess key.
 *
 * The relayer is expected to validate the delegate before submitting it. The
 * canonical relayer implementation in this repository rejects delegates that
 * are not signed by a scoped `charge` key.
 */
import { KeyPair, providers, transactions } from 'near-api-js';
import {
  buildDelegateAction,
  encodeDelegateAction,
  SignedDelegate,
  Signature,
  type DelegateAction,
} from '@near-js/transactions';
import { sha256 } from '@noble/hashes/sha256';

export const DEFAULT_CHARGE_GAS = '100000000000000'; // 100 Tgas
export const ED25519_KEY_TYPE = 0;

export interface ChargeDelegateParams {
  /** Account that owns the scoped Function-Call key (merchant or agent). */
  senderId: string;
  /** `ed25519:...` private key scoped to `<vaultId>::charge`. */
  privateKey: string;
  /** Tab Vault contract account. */
  vaultId: string;
  tabId: number;
  /** Atomic token amount. */
  amount: string;
  /** NEAR account that receives the token transfer. */
  receiverId: string;
  /** Invoice / idempotency reference. */
  reference: string;
  /** The Tab's current `next_nonce` value. */
  tabNonce: number;
  /** A value strictly greater than the current access-key nonce. */
  accessKeyNonce: number;
  /** Must be greater than the block height when the delegate is processed. */
  maxBlockHeight: number;
  gas?: string;
}

export interface DelegateFunctionCallJson {
  methodName: string;
  args: string; // base64-encoded JSON
  gas: string;
  deposit: string;
}

export interface SignedDelegateJson {
  senderId: string;
  receiverId: string;
  actions: Array<{ functionCall: DelegateFunctionCallJson }>;
  nonce: number;
  maxBlockHeight: number;
  publicKey: string;
  signature: string; // base64, 64-byte Ed25519 signature
}

export interface CreateDelegateResult {
  signedDelegate: SignedDelegate;
  delegate: SignedDelegateJson;
  delegateHash: string;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function signDelegateMessage(
  keyPair: KeyPair,
  delegateAction: DelegateAction
): { signature: Uint8Array; hash: Uint8Array } {
  const message = encodeDelegateAction(delegateAction);
  const hash = new Uint8Array(sha256(message));
  // NEP-366 verifies the signature over hash(delegate_action), not the raw
  // Borsh bytes. KeyPair.sign does not hash, so hash explicitly.
  const signature = keyPair.sign(hash).signature;
  return { signature, hash };
}

/**
 * Builds and signs a single-action `charge` delegate. No transaction is sent
 * and no NEAR is spent here.
 */
export function createChargeDelegate(
  params: ChargeDelegateParams
): CreateDelegateResult {
  const keyPair = KeyPair.fromString(params.privateKey as never);
  const publicKey = keyPair.getPublicKey();

  if (!publicKey.toString().startsWith('ed25519:')) {
    throw new Error('Only Ed25519 access keys are supported by this relayer.');
  }
  if (params.tabNonce < 0 || params.accessKeyNonce < 0) {
    throw new Error('Nonce values must be non-negative integers.');
  }
  if (params.accessKeyNonce <= 0) {
    throw new Error('The access-key nonce must be greater than zero.');
  }

  const args = {
    tab_id: params.tabId,
    amount: params.amount,
    receiver_id: params.receiverId,
    reference: params.reference,
    nonce: params.tabNonce,
  };
  const action = transactions.functionCall(
    'charge',
    args,
    BigInt(params.gas || DEFAULT_CHARGE_GAS),
    BigInt(0)
  );
  const delegateAction = buildDelegateAction({
    actions: [action],
    maxBlockHeight: BigInt(params.maxBlockHeight),
    nonce: BigInt(params.accessKeyNonce),
    publicKey,
    receiverId: params.vaultId,
    senderId: params.senderId,
  });
  const { signature, hash } = signDelegateMessage(keyPair, delegateAction);
  const signedDelegate = new SignedDelegate({
    delegateAction,
    signature: new Signature({ keyType: ED25519_KEY_TYPE, data: signature }),
  });

  const functionCall = (delegateAction.actions[0] as any).functionCall;
  const delegate: SignedDelegateJson = {
    senderId: delegateAction.senderId,
    receiverId: delegateAction.receiverId,
    actions: [
      {
        functionCall: {
          methodName: functionCall.methodName,
          args: toBase64(functionCall.args),
          gas: functionCall.gas.toString(),
          deposit: functionCall.deposit.toString(),
        },
      },
    ],
    nonce: Number(delegateAction.nonce),
    maxBlockHeight: Number(delegateAction.maxBlockHeight),
    publicKey: publicKey.toString(),
    signature: toBase64(signature),
  };

  return {
    signedDelegate,
    delegate,
    delegateHash: toHex(hash),
  };
}

export async function getAccessKeyNextNonce(
  provider: providers.Provider,
  accountId: string,
  publicKey: string
): Promise<number> {
  const key: any = await provider.query({
    request_type: 'view_access_key',
    finality: 'final',
    account_id: accountId,
    public_key: publicKey,
  });
  return Number(key.nonce) + 1;
}

export async function getLatestBlockHeight(
  provider: providers.Provider
): Promise<number> {
  const block: any = await (provider as any).sendJsonRpc('block', {
    finality: 'final',
  });
  return Number(block.header.height);
}

export interface RelayerStatus {
  enabled: boolean;
  network: string;
  relayer: string | null;
  relayerBalanceYocto: string | null;
  vault: string;
  token: string;
  maxGas: string;
}

export async function getRelayerStatus(
  keeperUrl = 'http://localhost:4000'
): Promise<RelayerStatus> {
  const res = await fetch(`${keeperUrl}/relay/status`);
  if (!res.ok) {
    throw new Error(`Relayer status failed: ${res.status}`);
  }
  return (await res.json()) as RelayerStatus;
}

export interface RelayResult {
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
}

/**
 * Submits the signed delegate to a relayer. The relayer API key is optional
 * for local tests and required by the repository's keeper configuration.
 */
export async function relayChargeDelegate(options: {
  keeperUrl?: string;
  apiKey?: string;
  delegate: SignedDelegateJson;
}): Promise<RelayResult> {
  const base = options.keeperUrl || 'http://localhost:4000';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

  const res = await fetch(`${base}/relay/delegate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ signedDelegate: options.delegate }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(json.error || `Relay failed: ${res.status}`);
    (error as any).code = json.code;
    (error as any).status = res.status;
    throw error;
  }
  return json as RelayResult;
}
