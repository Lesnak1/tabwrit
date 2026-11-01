import * as nearAPI from 'near-api-js';
import 'dotenv/config';

const { connect, keyStores, KeyPair, providers } = nearAPI;

export interface TabEvent {
  standard?: string;
  version?: string;
  event: string;
  data: any;
}

export interface CreateTabParams {
  spender: string;
  token: string;
  per_charge_cap: string;
  per_period_cap: string;
  total_cap: string;
  period_secs: number;
  duration_days: number;
  allowed_receivers?: string[];
  label: string;
}

export class TabNearClient {
  public networkId: string;
  public nodeUrl: string;
  public contractId: string;
  public accountId: string;
  private privateKey?: string;
  private provider: any;
  private keyStore: any;
  private nearPromise: Promise<any>;

  constructor() {
    this.networkId = process.env.NEAR_NETWORK || 'testnet';
    this.nodeUrl = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
    this.accountId = process.env.NEAR_ACCOUNT_ID || 'tab-agent.testnet';
    this.contractId =
      process.env.TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet';
    this.privateKey = process.env.NEAR_PRIVATE_KEY;

    this.provider = new providers.JsonRpcProvider({ url: this.nodeUrl });
    this.keyStore = new keyStores.InMemoryKeyStore();

    if (this.privateKey && this.accountId) {
      try {
        const keyPair = KeyPair.fromString(this.privateKey as any);
        this.keyStore.setKey(this.networkId, this.accountId, keyPair);
      } catch (err) {
        console.error('[TabNearClient] Failed to load KeyPair from NEAR_PRIVATE_KEY:', err);
      }
    }

    this.nearPromise = connect({
      networkId: this.networkId,
      nodeUrl: this.nodeUrl,
      keyStore: this.keyStore,
    });
  }

  /**
   * Performs an on-chain view call against the Tab Vault contract.
   * Does not require a signed transaction or private key.
   */
  async callViewMethod<T>(methodName: string, args: Record<string, any> = {}): Promise<T> {
    const rawResult: any = await this.provider.query({
      request_type: 'call_function',
      account_id: this.contractId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      finality: 'optimistic',
    });

    const parsed = JSON.parse(Buffer.from(rawResult.result).toString('utf8'));
    return parsed as T;
  }

  /**
   * Performs an on-chain state-changing transaction signed by the configured NEAR account.
   */
  async callChangeMethod(
    methodName: string,
    args: Record<string, any>,
    gas = '30000000000000', // 30 Tgas
    attachedDeposit = '0'
  ): Promise<{ result: any; txHash: string; events: TabEvent[] }> {
    if (!this.privateKey || !this.accountId) {
      throw new Error(
        'NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY are required in environment variables to execute change transactions.'
      );
    }

    const near = await this.nearPromise;
    const account = await near.account(this.accountId);

    const outcome = await account.functionCall({
      contractId: this.contractId,
      methodName,
      args,
      gas: BigInt(gas),
      attachedDeposit: BigInt(attachedDeposit),
    });

    const txHash = outcome.transaction.hash;
    let result: any = null;
    if (outcome.status && typeof outcome.status === 'object' && 'SuccessValue' in outcome.status) {
      const decoded = Buffer.from((outcome.status as any).SuccessValue, 'base64').toString('utf8');
      if (decoded.length > 0) {
        try {
          result = JSON.parse(decoded);
        } catch {
          result = decoded;
        }
      }
    }

    const events: TabEvent[] = [];
    for (const receipt of outcome.receipts_outcome || []) {
      for (const log of receipt.outcome.logs || []) {
        if (!log.startsWith('EVENT_JSON:')) continue;
        try {
          const parsed = JSON.parse(log.slice('EVENT_JSON:'.length));
          if (parsed && typeof parsed.event === 'string') {
            events.push(parsed);
          }
        } catch {
          // ignore malformed event logs
        }
      }
    }

    return { result, txHash, events };
  }

  /**
   * Retrieves Tab details by ID.
   */
  async getTab(tabId: number): Promise<any> {
    return this.callViewMethod('get_tab', { tab_id: Number(tabId) });
  }

  /**
   * Retrieves an account's deposited token balance inside the Vault.
   */
  async getVaultBalance(owner: string, token: string): Promise<string> {
    const balance = await this.callViewMethod<string>('get_balance', {
      owner,
      token,
    });
    return balance;
  }

  /**
   * Retrieves the remaining allowance for a Tab in the current period and lifetime.
   */
  async getRemainingAllowance(tabId: number): Promise<any> {
    return this.callViewMethod('get_remaining', { tab_id: Number(tabId) });
  }

  /**
   * Lists Tabs created by a specific owner account.
   */
  async listTabsByOwner(owner: string, fromIndex = 0, limit = 50): Promise<any[]> {
    return this.callViewMethod<any[]>('list_tabs_by_owner', {
      owner,
      from_index: fromIndex,
      limit,
    });
  }

  /**
   * Lists Tabs where the given account is authorized as the spender.
   */
  async listTabsBySpender(spender: string, fromIndex = 0, limit = 50): Promise<any[]> {
    return this.callViewMethod<any[]>('list_tabs_by_spender', {
      spender,
      from_index: fromIndex,
      limit,
    });
  }

  /**
   * Checks whether a NEP-141 token is allowlisted on the Vault.
   */
  async isTokenAllowed(token: string): Promise<boolean> {
    return this.callViewMethod<boolean>('is_token_allowed', { token });
  }

  /**
   * Creates a new Tab on NEAR Testnet.
   */
  async createTab(params: CreateTabParams): Promise<{ tabId: number; txHash: string }> {
    const nowNs = Date.now() * 1_000_000;
    const expiresAtNs = nowNs + params.duration_days * 86400 * 1_000_000_000;

    const receiverPolicy =
      params.allowed_receivers && params.allowed_receivers.length > 0
        ? { Allowlist: params.allowed_receivers }
        : 'Any';

    const args = {
      spender: params.spender,
      token: params.token,
      per_charge_cap: String(params.per_charge_cap),
      per_period_cap: String(params.per_period_cap),
      total_cap: String(params.total_cap),
      period_secs: Number(params.period_secs),
      expires_at_ns: Math.floor(expiresAtNs),
      receiver_policy: receiverPolicy,
      label: params.label,
    };

    const { result, txHash } = await this.callChangeMethod(
      'create_tab',
      args,
      '50000000000000',
      '10000000000000000000000'
    );

    return {
      tabId: Number(result),
      txHash,
    };
  }

  /**
   * Charges against a Tab.
   */
  async charge(
    tabId: number,
    amount: string,
    receiverId: string,
    reference: string
  ): Promise<{
    executionResult: any;
    txHash: string;
    nonce: number;
    events: TabEvent[];
  }> {
    const tab = await this.getTab(tabId);
    if (!tab) throw new Error(`Tab #${tabId} was not found on-chain.`);
    const nonce = Number(tab.next_nonce);

    const args = {
      tab_id: Number(tabId),
      amount: String(amount),
      receiver_id: receiverId,
      reference,
      nonce,
    };

    const { result, txHash, events } = await this.callChangeMethod(
      'charge',
      args,
      '100000000000000', // 100 Tgas for cross-contract ft_transfer and callback
      '0'
    );

    return {
      executionResult: result,
      txHash,
      nonce,
      events,
    };
  }

  /**
   * Pauses an active Tab.
   */
  async pauseTab(tabId: number): Promise<{ txHash: string }> {
    const { txHash } = await this.callChangeMethod('pause_tab', { id: Number(tabId) });
    return { txHash };
  }

  /**
   * Resumes a paused Tab.
   */
  async resumeTab(tabId: number): Promise<{ txHash: string }> {
    const { txHash } = await this.callChangeMethod('resume_tab', { id: Number(tabId) });
    return { txHash };
  }

  /**
   * Revokes a Tab permanently.
   */
  async revokeTab(tabId: number): Promise<{ txHash: string }> {
    const { txHash } = await this.callChangeMethod('revoke_tab', { id: Number(tabId) });
    return { txHash };
  }
}
