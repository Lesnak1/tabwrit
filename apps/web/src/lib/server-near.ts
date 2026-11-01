import 'server-only';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair, providers } = nearAPI;

const NETWORK = process.env.NEAR_NETWORK || 'testnet';
const RPC =
  process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const VAULT =
  process.env.TAB_VAULT_CONTRACT_ID ||
  process.env.NEXT_PUBLIC_TAB_VAULT_CONTRACT_ID ||
  'tab-vault.testnet';
const TOKEN =
  process.env.TAB_TOKEN_ID ||
  process.env.NEXT_PUBLIC_TAB_TOKEN_ID ||
  'tab-usdc.testnet';
const MERCHANT =
  process.env.MERCHANT_ACCOUNT_ID ||
  process.env.NEXT_PUBLIC_MERCHANT_ACCOUNT_ID ||
  'tab-merchant.testnet';
const MERCHANT_KEY =
  process.env.MERCHANT_CHARGE_PRIVATE_KEY ||
  process.env.TESTNET_MERCHANT_CHARGE_PRIVATE_KEY;
const INVOICE_AMOUNT =
  process.env.MERCHANT_INVOICE_AMOUNT ||
  process.env.NEXT_PUBLIC_MERCHANT_INVOICE_AMOUNT ||
  '10000000';

const EXPLORER =
  NETWORK === 'mainnet'
    ? 'https://nearblocks.io'
    : 'https://testnet.nearblocks.io';

const provider = new providers.JsonRpcProvider({ url: RPC });
let cachedAccount: nearAPI.Account | null = null;

export type ChargeResult = {
  kind: 'executed' | 'rejected' | 'failed' | 'error';
  reason?: string;
  txHash?: string;
  event?: any;
  explorerUrl?: string;
};

export function merchantConfig() {
  return {
    network: NETWORK,
    vault: VAULT,
    token: TOKEN,
    merchant: MERCHANT,
    invoiceAmount: INVOICE_AMOUNT,
    hasMerchantKey: Boolean(MERCHANT_KEY),
    gaslessAvailable: Boolean(MERCHANT_KEY && process.env.RELAYER_API_KEY),
    explorer: EXPLORER,
  };
}

async function view<T>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res: any = await provider.query({
    request_type: 'call_function',
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    finality: 'optimistic',
  });
  return JSON.parse(Buffer.from(res.result).toString('utf8')) as T;
}

export async function getTab(tabId: number): Promise<any> {
  return view(VAULT, 'get_tab', { tab_id: tabId });
}

export async function getRemaining(tabId: number): Promise<any> {
  return view(VAULT, 'get_remaining', { tab_id: tabId });
}

export async function getTokenBalance(accountId: string): Promise<string> {
  return view(TOKEN, 'ft_balance_of', { account_id: accountId });
}

async function getMerchantAccount(): Promise<nearAPI.Account> {
  if (!MERCHANT_KEY) {
    throw new Error(
      'MERCHANT_CHARGE_PRIVATE_KEY is not configured on the server. See .env.example.'
    );
  }
  if (cachedAccount) return cachedAccount;

  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(
    NETWORK,
    MERCHANT,
    KeyPair.fromString(MERCHANT_KEY as never)
  );
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore });
  cachedAccount = await near.account(MERCHANT);
  return cachedAccount;
}

function decodeSuccessValue(outcome: any): any {
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

function findEvent(outcome: any, name: string): any {
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

function txFromError(err: any): string | undefined {
  return (
    err?.transaction_outcome?.id ||
    err?.transaction?.hash ||
    err?.transaction_outcome?.transaction?.hash
  );
}

/**
 * Executes the merchant invoice against a Tab. The signer is the merchant
 * account; its key is a Function-Call Access Key scoped to `charge`.
 *
 * The amount and receiver are fixed by the merchant; the browser cannot
 * redirect the payment.
 */
export async function chargeInvoice(
  tabId: number,
  reference: string
): Promise<ChargeResult> {
  const tab = await getTab(tabId);
  if (!tab) {
    return { kind: 'error', reason: `Tab #${tabId} was not found.` };
  }
  if (tab.spender !== MERCHANT) {
    return {
      kind: 'error',
      reason: `Tab #${tabId} does not authorize ${MERCHANT}.`,
    };
  }
  if (tab.token !== TOKEN) {
    return {
      kind: 'error',
      reason: `Tab #${tabId} is not denominated in ${TOKEN}.`,
    };
  }
  if (tab.status !== 'Active') {
    return {
      kind: 'rejected',
      reason: 'TAB_NOT_ACTIVE',
      txHash: undefined,
      explorerUrl: undefined,
    };
  }
  if (Date.now() * 1_000_000 >= Number(tab.expires_at_ns)) {
    return { kind: 'rejected', reason: 'TAB_EXPIRED' };
  }

  const nonce = Number(tab.next_nonce);
  try {
    const account = await getMerchantAccount();
    const outcome: any = await account.functionCall({
      contractId: VAULT,
      methodName: 'charge',
      args: {
        tab_id: tabId,
        amount: INVOICE_AMOUNT,
        receiver_id: MERCHANT,
        reference,
        nonce,
      },
      gas: BigInt('100000000000000'),
      attachedDeposit: BigInt(0),
    });

    const value = decodeSuccessValue(outcome);
    const txHash = outcome?.transaction?.hash;
    if (value?.Rejected) {
      const reason = String(value.Rejected.reason || 'REJECTED');
      return {
        kind: 'rejected',
        reason: reason.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, ''),
        txHash,
        event: findEvent(outcome, 'charge_rejected'),
        explorerUrl: txHash ? `${EXPLORER}/txns/${txHash}` : undefined,
      };
    }

    const executed = findEvent(outcome, 'charge_executed');
    if (executed) {
      return {
        kind: 'executed',
        txHash,
        event: executed,
        explorerUrl: txHash ? `${EXPLORER}/txns/${txHash}` : undefined,
      };
    }

    const failed = findEvent(outcome, 'charge_failed');
    if (failed) {
      return {
        kind: 'failed',
        reason: failed.data?.reason || 'FT_TRANSFER_FAILED',
        txHash,
        event: failed,
        explorerUrl: txHash ? `${EXPLORER}/txns/${txHash}` : undefined,
      };
    }

    return {
      kind: 'error',
      reason: 'The charge returned an unknown outcome.',
      txHash,
      explorerUrl: txHash ? `${EXPLORER}/txns/${txHash}` : undefined,
    };
  } catch (err: any) {
    const txHash = txFromError(err);
    return {
      kind: 'error',
      reason: String(err?.message || err).slice(0, 240),
      txHash,
      explorerUrl: txHash ? `${EXPLORER}/txns/${txHash}` : undefined,
    };
  }
}
