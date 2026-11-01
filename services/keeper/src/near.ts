import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair } = nearAPI;

export interface NearServiceConfig {
  networkId: string;
  nodeUrl: string;
  vaultContractId: string;
  tokenId: string;
  spenderAccountId: string;
  spenderPrivateKey?: string;
  storageAccountId?: string;
  storagePrivateKey?: string;
}

export type ChargeResult = {
  kind: 'executed' | 'rejected' | 'failed' | 'error';
  reason?: string;
  txHash?: string;
  event?: any;
  explorerUrl?: string;
};

const EXPLORER = 'https://nearblocks.io';

export class NearService {
  private config: NearServiceConfig;
  private provider: nearAPI.providers.JsonRpcProvider;
  private connection: nearAPI.Near | null = null;
  private spenderAccount: nearAPI.Account | null = null;
  private storageAccount: nearAPI.Account | null = null;

  constructor(config?: Partial<NearServiceConfig>) {
    this.config = {
      networkId: config?.networkId || process.env.NEAR_NETWORK || 'testnet',
      nodeUrl:
        config?.nodeUrl ||
        process.env.NEAR_RPC_URL ||
        'https://test.rpc.fastnear.com',
      vaultContractId:
        config?.vaultContractId ||
        process.env.TAB_VAULT_CONTRACT_ID ||
        'tab-vault.testnet',
      tokenId:
        config?.tokenId || process.env.TAB_TOKEN_ID || 'tab-usdc.testnet',
      spenderAccountId:
        config?.spenderAccountId ||
        process.env.MERCHANT_ACCOUNT_ID ||
        'tab-merchant.testnet',
      spenderPrivateKey:
        config?.spenderPrivateKey ||
        process.env.MERCHANT_CHARGE_PRIVATE_KEY ||
        process.env.TESTNET_MERCHANT_CHARGE_PRIVATE_KEY,
      storageAccountId:
        config?.storageAccountId || process.env.STORAGE_ACCOUNT_ID,
      storagePrivateKey:
        config?.storagePrivateKey || process.env.STORAGE_PRIVATE_KEY,
    };
    this.provider = new nearAPI.providers.JsonRpcProvider({
      url: this.config.nodeUrl,
    });
  }

  async init(): Promise<void> {
    const keyStore = new keyStores.InMemoryKeyStore();
    if (this.config.spenderPrivateKey) {
      await keyStore.setKey(
        this.config.networkId,
        this.config.spenderAccountId,
        KeyPair.fromString(this.config.spenderPrivateKey as never)
      );
    }
    if (
      this.config.storageAccountId &&
      this.config.storagePrivateKey
    ) {
      await keyStore.setKey(
        this.config.networkId,
        this.config.storageAccountId,
        KeyPair.fromString(this.config.storagePrivateKey as never)
      );
    }

    this.connection = await connect({
      networkId: this.config.networkId,
      nodeUrl: this.config.nodeUrl,
      keyStore,
    });
    this.spenderAccount = await this.connection.account(
      this.config.spenderAccountId
    );
    if (this.config.storageAccountId && this.config.storagePrivateKey) {
      this.storageAccount = await this.connection.account(
        this.config.storageAccountId
      );
    }
  }

  async getRemaining(tabId: number): Promise<any> {
    return this.view('get_remaining', { tab_id: tabId });
  }

  async getTab(tabId: number): Promise<any> {
    return this.view('get_tab', { tab_id: tabId });
  }

  async getConfig(): Promise<any> {
    return this.view('get_config', {});
  }

  async getStorageBalance(tokenContract: string, accountId: string): Promise<any> {
    try {
      const res: any = await this.provider.query({
        request_type: 'call_function',
        account_id: tokenContract,
        method_name: 'storage_balance_of',
        args_base64: Buffer.from(JSON.stringify({ account_id: accountId })).toString('base64'),
        finality: 'optimistic',
      });
      return JSON.parse(Buffer.from(res.result).toString('utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Registers a 1Click deposit address on the origin NEP-141 token. A
   * Function-Call key cannot attach the storage deposit, so this must use a
   * separate storage account. Returns false when the address is not
   * registered and no storage account is configured.
   */
  async ensureStorageRegistered(
    tokenContract: string,
    accountId: string
  ): Promise<boolean> {
    if (!this.connection) await this.init();
    const balance = await this.getStorageBalance(tokenContract, accountId);
    if (balance !== null) return true;
    if (!this.storageAccount) {
      console.warn(
        `[keeper] ${accountId} is not registered on ${tokenContract}; set STORAGE_ACCOUNT_ID/STORAGE_PRIVATE_KEY to register it.`
      );
      return false;
    }
    await this.storageAccount.functionCall({
      contractId: tokenContract,
      methodName: 'storage_deposit',
      args: { account_id: accountId, registration_only: true },
      gas: BigInt('30000000000000'),
      attachedDeposit: BigInt('12500000000000000000000'),
    });
    return true;
  }

  /**
   * Executes a charge with the merchant's Function-Call Access Key. The key
   * must be scoped to `<vault>::charge`; it cannot attach a deposit and
   * cannot call any other method.
   */
  async executeCharge(
    tabId: number,
    amount: string,
    receiverId: string,
    reference: string
  ): Promise<ChargeResult> {
    if (!this.spenderAccount) await this.init();
    const tab = await this.getTab(tabId);
    if (!tab) return { kind: 'error', reason: 'TAB_NOT_FOUND' };

    try {
      const outcome: any = await this.spenderAccount!.functionCall({
        contractId: this.config.vaultContractId,
        methodName: 'charge',
        args: {
          tab_id: tabId,
          amount,
          receiver_id: receiverId,
          reference,
          nonce: Number(tab.next_nonce),
        },
        gas: BigInt('100000000000000'),
        attachedDeposit: BigInt(0),
      });

      const txHash = outcome?.transaction?.hash;
      const explorerUrl = txHash ? `${EXPLORER}/txns/${txHash}` : undefined;

      const success = this.decodeSuccessValue(outcome);
      if (success?.Rejected) {
        return {
          kind: 'rejected',
          reason: String(success.Rejected.reason || 'REJECTED'),
          txHash,
          event: this.findEvent(outcome, 'charge_rejected'),
          explorerUrl,
        };
      }

      const executed = this.findEvent(outcome, 'charge_executed');
      if (executed) {
        return { kind: 'executed', txHash, event: executed, explorerUrl };
      }
      const failed = this.findEvent(outcome, 'charge_failed');
      if (failed) {
        return {
          kind: 'failed',
          reason: failed.data?.reason || 'FT_TRANSFER_FAILED',
          txHash,
          event: failed,
          explorerUrl,
        };
      }
      return { kind: 'error', reason: 'UNKNOWN_OUTCOME', txHash, explorerUrl };
    } catch (err: any) {
      const txHash =
        err?.transaction_outcome?.id ||
        err?.transaction?.hash ||
        err?.transaction_outcome?.transaction?.hash;
      return {
        kind: 'error',
        reason: String(err?.message || err).slice(0, 240),
        txHash,
        explorerUrl: txHash ? `${EXPLORER}/txns/${txHash}` : undefined,
      };
    }
  }

  private async view(method: string, args: Record<string, unknown>): Promise<any> {
    const res: any = await this.provider.query({
      request_type: 'call_function',
      account_id: this.config.vaultContractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      finality: 'optimistic',
    });
    return JSON.parse(Buffer.from(res.result).toString('utf8'));
  }

  private decodeSuccessValue(outcome: any): any {
    const status = outcome?.status;
    if (status && typeof status === 'object' && 'SuccessValue' in status) {
      const raw = Buffer.from(status.SuccessValue, 'base64').toString('utf8');
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
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
