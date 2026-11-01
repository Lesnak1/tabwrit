import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { OneClickClient, OneClickToken } from './oneclick.js';
import { NearService } from './near.js';
import { ReceiptStore } from './receipts.js';
import { RelayerService, RelayError } from './relayer.js';
import { WebhookDispatcher } from './webhook.js';

dotenv.config();

const app = express();
app.use(
  cors({
    origin: process.env.KEEPER_CORS_ORIGIN || 'http://localhost:3005',
  })
);
app.use(express.json({ limit: '64kb' }));

const oneClick = new OneClickClient(
  process.env.ONECLICK_API_URL,
  process.env.ONECLICK_JWT
);
const near = new NearService();
const receipts = new ReceiptStore();
const relayer = new RelayerService();
const webhook = new WebhookDispatcher();

const NETWORK = process.env.NEAR_NETWORK || 'testnet';
const VAULT = process.env.TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet';
const TOKEN = process.env.TAB_TOKEN_ID || 'tab-usdc.testnet';
const MERCHANT = process.env.MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';
const API_KEY = process.env.KEEPER_API_KEY;
const EXPLORER =
  NETWORK === 'mainnet'
    ? 'https://nearblocks.io'
    : 'https://testnet.nearblocks.io';

function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (!API_KEY) {
    return res.status(503).json({
      error:
        'KEEPER_API_KEY is not configured. The keeper does not expose charge endpoints without authentication.',
    });
  }
  if (req.headers.authorization !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireRelayerKey(req: Request, res: Response, next: NextFunction) {
  const relayerKey = process.env.RELAYER_API_KEY;
  if (!relayerKey) {
    return res.status(503).json({
      error:
        'RELAYER_API_KEY is not configured. The NEP-366 relayer does not accept delegates without authentication.',
      code: 'RELAYER_DISABLED',
    });
  }
  if (req.headers.authorization !== `Bearer ${relayerKey}`) {
    return res.status(401).json({
      error: 'Unauthorized relayer request.',
      code: 'RELAYER_UNAUTHORIZED',
    });
  }
  next();
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    network: NETWORK,
    vault: VAULT,
    token: TOKEN,
    merchant: MERCHANT,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Public status for the NEP-366 relayer. It exposes only the relayer's public
 * account and balance; no key or signature material.
 */
app.get('/relay/status', async (_req: Request, res: Response) => {
  try {
    res.json(await relayer.status());
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * Authenticated gas meter. Merchants and agent platforms can see the actual
 * NEAR gas their relays consumed. This is the basis for prepaid credits; no
 * fee is taken inside the vault.
 */
app.get('/relay/usage', requireRelayerKey, (_req: Request, res: Response) => {
  res.json(relayer.usageReport());
});

/**
 * Gasless merchant / agent charge. The caller submits a delegate signed by a
 * Function-Call key scoped to `<vault>::charge`; the relayer pays the gas.
 * This endpoint is authenticated so the relayer cannot be used as an open gas
 * faucet.
 */
app.post('/relay/delegate', requireRelayerKey, async (req: Request, res: Response) => {
  try {
    const result = await relayer.relay(req.body?.signedDelegate);
    res.json(result);
  } catch (err: any) {
    if (err instanceof RelayError) {
      return res.status(err.status).json({
        error: err.message,
        code: err.code,
        ...(err.details || {}),
      });
    }
    res.status(500).json({
      error: err?.message || 'Relay failed.',
      code: 'RELAY_FAILED',
    });
  }
});

app.get('/tokens', async (_req: Request, res: Response) => {
  try {
    res.json(await oneClick.getTokens());
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * Live 1Click quote preview. `dry: true` never creates a deposit address and
 * never moves funds. This is the only 1Click mode the testnet keeper exposes.
 */
app.post('/quote', async (req: Request, res: Response) => {
  try {
    const {
      originAsset,
      destinationAsset,
      amount,
      recipient,
      refundTo,
    } = req.body;

    if (!originAsset || !destinationAsset || !amount || !recipient) {
      return res.status(400).json({
        error:
          'Missing required fields: originAsset, destinationAsset, amount, recipient',
      });
    }

    const quote = await oneClick.getQuote({
      dry: true,
      swapType: 'EXACT_OUTPUT',
      slippageTolerance: 100,
      originAsset,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset,
      amount: String(amount),
      refundTo: refundTo || process.env.ONECLICK_REFUND_ACCOUNT || 'near.near',
      refundType: 'ORIGIN_CHAIN',
      recipient,
      recipientType: 'DESTINATION_CHAIN',
    });

    res.json({
      mode: 'quote-only',
      note: 'Live mainnet 1Click route quote. No funds move in this call.',
      quote,
    });
  } catch (err: any) {
    res.status(422).json({ error: err.message });
  }
});

/**
 * Authenticated merchant settlement endpoint.
 *
 * This path is intentionally mainnet-only: 1Click does not operate on
 * testnet. The testnet demo uses the web app's on-chain tUSDC merchant
 * checkout instead.
 */
app.post('/charge', requireApiKey, async (req: Request, res: Response) => {
  if (NETWORK !== 'mainnet') {
    return res.status(501).json({
      error:
        'The 1Click settlement keeper is mainnet-only. Use the testnet merchant checkout for on-chain tUSDC, or deploy the same contract on mainnet with USDC.',
      code: 'MAINNET_REQUIRED',
    });
  }

  const {
    tabId,
    merchantAsset,
    merchantAmount,
    merchantRecipient,
    reference = `inv_${Date.now()}`,
    webhookUrl,
    webhookSecret,
  } = req.body;

  if (!tabId || !merchantAsset || !merchantAmount || !merchantRecipient) {
    return res.status(400).json({
      error:
        'Missing required fields: tabId, merchantAsset, merchantAmount, merchantRecipient',
    });
  }
  if (!/^\d+$/.test(String(merchantAmount)) || BigInt(merchantAmount) <= 0n) {
    return res.status(400).json({
      error: 'merchantAmount must be a positive integer in destination base units.',
    });
  }

  try {
    const tab = await near.getTab(Number(tabId));
    if (!tab) {
      return res.status(404).json({ error: `Tab #${tabId} not found on-chain` });
    }
    if (tab.spender !== MERCHANT) {
      return res.status(403).json({
        error: `Tab #${tabId} does not authorize ${MERCHANT}`,
      });
    }
    if (tab.token !== TOKEN) {
      return res.status(400).json({
        error: `Tab #${tabId} is not denominated in ${TOKEN}`,
      });
    }
    if (tab.status !== 'Active') {
      return res.status(409).json({
        error: `Tab #${tabId} is ${tab.status}`,
        code: 'TAB_NOT_ACTIVE',
      });
    }
    if (Date.now() * 1_000_000 >= Number(tab.expires_at_ns)) {
      return res.status(409).json({
        error: `Tab #${tabId} has expired`,
        code: 'TAB_EXPIRED',
      });
    }
    if (typeof tab.receiver_policy === 'object') {
      return res.status(422).json({
        error:
          'This Tab uses a fixed receiver allowlist. 1Click settlement requires a Tab with ReceiverPolicy::Any, because the deposit address changes for every quote.',
        code: 'ALLOWLIST_INCOMPATIBLE_WITH_INTENTS',
      });
    }

    const tokens = await oneClick.getTokens();
    const origin = tokens.find(
      (t: OneClickToken) => t.assetId === `nep141:${TOKEN}`
    );
    const destination = tokens.find(
      (t: OneClickToken) => t.assetId === merchantAsset
    );
    if (!origin) {
      return res.status(422).json({
        error: `1Click does not list the Tab token (nep141:${TOKEN}).`,
      });
    }
    if (!destination) {
      return res.status(422).json({
        error: '1Click does not list the requested destination asset.',
      });
    }

    const quotePayload: any = await oneClick.getQuote({
      dry: false,
      swapType: 'EXACT_OUTPUT',
      slippageTolerance: 100,
      originAsset: origin.assetId,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: destination.assetId,
      amount: String(merchantAmount),
      refundTo: tab.owner,
      refundType: 'ORIGIN_CHAIN',
      recipient: merchantRecipient,
      recipientType: 'DESTINATION_CHAIN',
    });

    const depositAddress: string | undefined =
      quotePayload?.quote?.depositAddress;
    const amountIn: string | undefined = quotePayload?.quote?.amountIn;
    const amountOut: string | undefined = quotePayload?.quote?.amountOut;
    if (!depositAddress || !amountIn || !amountOut) {
      return res.status(502).json({
        error:
          '1Click did not return a deposit address, input amount or output amount.',
      });
    }
    if (BigInt(amountOut) !== BigInt(merchantAmount)) {
      return res.status(502).json({
        error: `1Click quote output ${amountOut} does not match the invoice ${merchantAmount}.`,
        code: 'QUOTE_OUTPUT_MISMATCH',
      });
    }

    if (BigInt(amountIn) > BigInt(tab.per_charge_cap)) {
      return res.status(422).json({
        error: `Quoted input ${amountIn} exceeds per_charge_cap ${tab.per_charge_cap}`,
        code: 'PER_CHARGE_CAP',
      });
    }
    const remaining = await near.getRemaining(Number(tabId));
    if (BigInt(amountIn) > BigInt(remaining.remaining_in_period)) {
      return res.status(422).json({
        error: `Quoted input ${amountIn} exceeds the period budget`,
        code: 'PERIOD_CAP',
      });
    }
    if (BigInt(amountIn) > BigInt(remaining.remaining_total)) {
      return res.status(422).json({
        error: `Quoted input ${amountIn} exceeds the lifetime budget`,
        code: 'TOTAL_CAP',
      });
    }

    const registered = await near.ensureStorageRegistered(TOKEN, depositAddress);
    if (!registered) {
      return res.status(422).json({
        error:
          'The 1Click deposit address is not registered on the NEP-141 token. Configure STORAGE_ACCOUNT_ID/STORAGE_PRIVATE_KEY or register it first.',
        code: 'STORAGE_NOT_REGISTERED',
      });
    }

    const charge = await near.executeCharge(
      Number(tabId),
      amountIn,
      depositAddress,
      String(reference).slice(0, 128)
    );

    if (charge.kind !== 'executed') {
      return res
        .status(charge.kind === 'rejected' ? 409 : 502)
        .json({ ...charge, config: { network: NETWORK, vault: VAULT } });
    }

    await oneClick.submitDepositTx(depositAddress, charge.txHash!);

    const receiptId = `rcpt_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    receipts.addReceipt({
      id: receiptId,
      tabId: Number(tabId),
      reference: String(reference),
      timestamp: new Date().toISOString(),
      merchantAsset,
      merchantAmount: String(merchantAmount),
      merchantRecipient: String(merchantRecipient),
      originAsset: origin.assetId,
      originAmountIn: amountIn,
      depositAddress,
      chargeTxHash: charge.txHash!,
      settlementStatus: 'PROCESSING',
      explorerUrl: `${EXPLORER}/txns/${charge.txHash}`,
    });

    if (webhookUrl) {
      webhook
        .dispatch({
          url: webhookUrl,
          secret: webhookSecret,
          event: 'tab.charge.deposited',
          data: {
            receiptId,
            tabId: Number(tabId),
            reference,
            chargeTxHash: charge.txHash,
            amountIn,
            originAsset: origin.assetId,
            merchantAsset,
            merchantAmount: String(merchantAmount),
            merchantRecipient,
            explorerUrl: `${EXPLORER}/txns/${charge.txHash}`,
            timestamp: new Date().toISOString(),
          },
        })
        .catch(() => {});
    }

    startStatusMonitor(
      receiptId,
      depositAddress,
      webhookUrl,
      webhookSecret
    );

    return res.json({
      status: 'deposited',
      receiptId,
      tabId: Number(tabId),
      reference,
      chargeTxHash: charge.txHash,
      depositAddress,
      originAmountIn: amountIn,
      explorerUrl: `${EXPLORER}/txns/${charge.txHash}`,
      settlementStatus: 'PROCESSING',
    });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

app.get('/receipts', requireApiKey, (req: Request, res: Response) => {
  const tabId = req.query.tab ? Number(req.query.tab) : undefined;
  res.json(receipts.listReceipts(tabId));
});

function startStatusMonitor(
  receiptId: string,
  depositAddress: string,
  webhookUrl?: string,
  webhookSecret?: string
) {
  let attempts = 0;
  let notified = false;
  const maxAttempts = 120; // 10 minutes at 5s
  const interval = setInterval(async () => {
    attempts++;
    try {
      const statusData = await oneClick.getStatus(depositAddress);
      receipts.updateStatus(receiptId, statusData.status, statusData.swapDetails);

      if (statusData.status === 'SUCCESS' && webhookUrl && !notified) {
        notified = true;
        webhook
          .dispatch({
            url: webhookUrl,
            secret: webhookSecret,
            event: 'tab.settlement.succeeded',
            data: {
              receiptId,
              settlementStatus: statusData.status,
              swapDetails: statusData.swapDetails,
              timestamp: new Date().toISOString(),
            },
          })
          .catch(() => {});
      }

      if (
        ['SUCCESS', 'FAILED', 'REFUNDED'].includes(statusData.status) ||
        attempts >= maxAttempts
      ) {
        clearInterval(interval);
      }
    } catch {
      if (attempts >= maxAttempts) clearInterval(interval);
    }
  }, 5000);
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[keeper] listening on http://localhost:${PORT}`);
  console.log(`[keeper] network=${NETWORK} vault=${VAULT} token=${TOKEN}`);
  console.log(
    `[keeper] 1Click settlement: ${
      NETWORK === 'mainnet' ? 'enabled' : 'mainnet-only (testnet returns 501)'
    }`
  );
});
