import 'server-only';
import * as nearAPI from 'near-api-js';
import { buildDelegateAction, encodeDelegateAction } from '@near-js/transactions';
import { sha256 } from '@noble/hashes/sha256';
import { getTab, merchantConfig, type ChargeResult } from './server-near';

const { KeyPair, providers, transactions } = nearAPI;

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const KEEPER_URL = process.env.KEEPER_URL || 'http://localhost:4000';
const RELAYER_API_KEY = process.env.RELAYER_API_KEY;
const MERCHANT_KEY =
  process.env.MERCHANT_CHARGE_PRIVATE_KEY ||
  process.env.TESTNET_MERCHANT_CHARGE_PRIVATE_KEY;

const provider = new providers.JsonRpcProvider({ url: RPC });
const CHARGE_GAS = '100000000000000'; // 100 Tgas

export type GaslessChargeResult = ChargeResult & {
  gasless?: boolean;
  relayer?: string;
  sender?: string;
  gasPaidBy?: string;
};

export function gaslessAvailable(): boolean {
  return Boolean(MERCHANT_KEY && RELAYER_API_KEY);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

async function buildDelegate(tabId: number, reference: string): Promise<any> {
  if (!MERCHANT_KEY) {
    throw new Error(
      'MERCHANT_CHARGE_PRIVATE_KEY is not configured on the server.'
    );
  }
  const config = merchantConfig();
  const tab = await getTab(tabId);
  if (!tab) throw new Error(`Tab #${tabId} was not found.`);
  if (tab.spender !== config.merchant) {
    throw new Error(`Tab #${tabId} does not authorize ${config.merchant}.`);
  }
  if (tab.token !== config.token) {
    throw new Error(`Tab #${tabId} is not denominated in ${config.token}.`);
  }
  if (tab.status !== 'Active') throw new Error(`Tab #${tabId} is ${tab.status}.`);
  if (Date.now() * 1_000_000 >= Number(tab.expires_at_ns)) {
    throw new Error(`Tab #${tabId} has expired.`);
  }

  const keyPair = KeyPair.fromString(MERCHANT_KEY as never);
  const publicKey = keyPair.getPublicKey().toString();
  if (!publicKey.startsWith('ed25519:')) {
    throw new Error('The gasless path requires an Ed25519 merchant key.');
  }

  const accessKey: any = await provider.query({
    request_type: 'view_access_key',
    finality: 'final',
    account_id: config.merchant,
    public_key: publicKey,
  });
  const permission = accessKey?.permission;
  if (
    !permission ||
    typeof permission !== 'object' ||
    permission.FunctionCall?.receiver_id !== config.vault ||
    !permission.FunctionCall?.method_names?.includes('charge')
  ) {
    throw new Error(
      'The merchant charge key is not scoped to <vault>::charge; refusing to sign a delegate.'
    );
  }

  const block: any = await provider.sendJsonRpc('block', { finality: 'final' });
  const accessKeyNonce = Number(accessKey.nonce) + 1;
  const maxBlockHeight = Number(block.header.height) + 80;

  const args = {
    tab_id: tabId,
    amount: config.invoiceAmount,
    receiver_id: config.merchant,
    reference,
    nonce: Number(tab.next_nonce),
  };
  const action = transactions.functionCall(
    'charge',
    args,
    BigInt(CHARGE_GAS),
    BigInt(0)
  );
  const delegateAction = buildDelegateAction({
    actions: [action],
    maxBlockHeight: BigInt(maxBlockHeight),
    nonce: BigInt(accessKeyNonce),
    publicKey: keyPair.getPublicKey(),
    receiverId: config.vault,
    senderId: config.merchant,
  });
  const message = encodeDelegateAction(delegateAction);
  const hash = new Uint8Array(sha256(message));
  const signature = keyPair.sign(hash).signature;

  return {
    senderId: config.merchant,
    receiverId: config.vault,
    actions: [
      {
        functionCall: {
          methodName: 'charge',
          args: toBase64(Buffer.from(JSON.stringify(args), 'utf8')),
          gas: CHARGE_GAS,
          deposit: '0',
        },
      },
    ],
    nonce: accessKeyNonce,
    maxBlockHeight,
    publicKey,
    signature: toBase64(signature),
  };
}

/**
 * Signs a `charge` delegate with the merchant's scoped key and asks the
 * keeper's relayer to submit it. The merchant server never needs a NEAR
 * balance for gas; the relayer pays it.
 */
export async function chargeInvoiceGasless(
  tabId: number,
  reference: string
): Promise<GaslessChargeResult> {
  if (!RELAYER_API_KEY) {
    return {
      kind: 'error',
      reason:
        'RELAYER_API_KEY is not configured on the web server. Set it to enable the gasless path.',
    };
  }
  try {
    const delegate = await buildDelegate(tabId, reference);
    const res = await fetch(`${KEEPER_URL}/relay/delegate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${RELAYER_API_KEY}`,
      },
      body: JSON.stringify({ signedDelegate: delegate }),
      cache: 'no-store',
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        kind: 'error',
        reason: json.error || `Relayer returned ${res.status}.`,
        txHash: json.txHash,
        explorerUrl: json.explorerUrl,
      };
    }
    return {
      kind:
        json.status === 'executed'
          ? 'executed'
          : json.status === 'rejected'
          ? 'rejected'
          : json.status === 'failed'
          ? 'failed'
          : 'error',
      reason: json.reason,
      txHash: json.txHash,
      explorerUrl: json.explorerUrl,
      event: json.event,
      gasless: true,
      relayer: json.relayer,
      sender: json.senderId,
      gasPaidBy: json.gasPaidBy,
    };
  } catch (err: any) {
    return {
      kind: 'error',
      reason: String(err?.message || err).slice(0, 240),
    };
  }
}
