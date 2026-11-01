/**
 * x402-style HTTP 402 paid API used by the TabWrit agent demo.
 *
 * This is a real HTTP 402 flow with a TabWrit payment scheme, not a full
 * x402 protocol implementation:
 *   - an unpaid request returns a 402 challenge bound to a single invoice;
 *   - the agent pays that invoice with a Tab charge on NEAR testnet;
 *   - the API verifies the on-chain `charge_executed` event, the Tab, the
 *     payer, the receiver, the asset, the amount and the invoice reference
 *     before returning any data;
 *   - the invoice and the transaction hash can each be used only once.
 *
 * It keeps no private key. The demo binds the server to 127.0.0.1 and returns
 * live testnet data, never a fabricated report.
 */
import crypto from 'node:crypto';
import http from 'node:http';

export interface X402ApiOptions {
  payTo: string;
  asset: string;
  amount: string;
  tabId: number;
  vault: string;
  /**
   * Expected Tab spender. The NEAR RPC needs the transaction sender to fetch
   * the receipt; setting this lets the API distinguish "wrong payer" from
   * "unknown transaction" when someone presents another account's receipt.
   */
  payer?: string;
  rpc?: string;
  network?: string;
  host?: string;
  port?: number;
  resourcePath?: string;
  description?: string;
  invoiceTtlSeconds?: number;
}

export interface X402Api {
  server: http.Server;
  url: string;
  usedReceipts: Set<string>;
  close: () => Promise<void>;
}

interface Invoice {
  id: string;
  reference: string;
  amount: string;
  payTo: string;
  asset: string;
  tabId: number;
  resource: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'content-type,x-tab-receipt,x-tab-payer,x-tab-invoice,x-tab-tab',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function isAccountId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.length <= 64 &&
    /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value)
  );
}

function findEvent(outcome: any, name: string, contractId: string): any {
  for (const receipt of outcome?.receipts_outcome || []) {
    // Only trust events emitted by the vault itself. A callee could otherwise
    // emit a look-alike event and trick the API into accepting a payment that
    // the vault never settled.
    if (receipt?.outcome?.executor_id !== contractId) continue;
    for (const log of receipt?.outcome?.logs || []) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      try {
        const event = JSON.parse(log.slice('EVENT_JSON:'.length));
        if (event?.standard === 'tab' && event?.event === name) return event;
      } catch {
        // ignore malformed logs
      }
    }
  }
  return null;
}

export async function startX402Api(options: X402ApiOptions): Promise<X402Api> {
  const rpc = options.rpc || 'https://test.rpc.fastnear.com';
  const network = options.network || 'testnet';
  const host = options.host || '127.0.0.1';
  const port = options.port ?? 4021;
  const resourcePath = options.resourcePath || '/premium/report';
  const description =
    options.description || 'TabWrit premium NEAR testnet report';
  const invoiceTtlSeconds = options.invoiceTtlSeconds ?? 300;
  const usedReceipts = new Set<string>();
  const invoices = new Map<string, Invoice>();

  if (!isAccountId(options.payTo)) {
    throw new Error('X402 payTo must be a valid NEAR account ID.');
  }
  if (!isAccountId(options.asset)) {
    throw new Error('X402 asset must be a valid NEAR account ID.');
  }
  if (!isAccountId(options.vault)) {
    throw new Error('X402 vault must be a valid NEAR account ID.');
  }
  if (options.payer !== undefined && !isAccountId(options.payer)) {
    throw new Error('X402 payer must be a valid NEAR account ID.');
  }
  if (!/^\d+$/.test(String(options.amount)) || BigInt(options.amount) <= 0n) {
    throw new Error('X402 amount must be a positive integer string.');
  }

  async function rpcCall(method: string, params: unknown): Promise<any> {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params }),
    });
    const body: any = await res.json();
    if (body.error) {
      throw new Error(body.error.message || body.error.data || 'RPC error');
    }
    return body.result;
  }

  async function view(
    account: string,
    method: string,
    args: Record<string, unknown>
  ): Promise<any> {
    const result = await rpcCall('query', {
      request_type: 'call_function',
      account_id: account,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      finality: 'final',
    });
    return JSON.parse(Buffer.from(result.result, 'base64').toString('utf8'));
  }

  async function getBlockHeight(): Promise<number> {
    const block = await rpcCall('block', { finality: 'final' });
    return Number(block.header.height);
  }

  function createInvoice(resource: string): Invoice {
    const id = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const invoice: Invoice = {
      id,
      reference: `x402:${id}`,
      amount: String(options.amount),
      payTo: options.payTo,
      asset: options.asset,
      tabId: options.tabId,
      resource,
      createdAt: now,
      expiresAt: now + invoiceTtlSeconds * 1000,
      used: false,
    };
    invoices.set(id, invoice);
    return invoice;
  }

  async function verifyReceipt(
    receipt: string,
    payer: string,
    invoice: Invoice
  ): Promise<{
    ok: boolean;
    code?: string;
    event?: any;
    error?: string;
    replay?: boolean;
  }> {
    let tx: any;
    try {
      // The NEAR RPC needs the transaction sender to resolve the receipt.
      // When the API knows the expected Tab spender, it can fetch the receipt
      // and still reject a different header payer with WRONG_PAYER.
      tx = await rpcCall('tx', {
        tx_hash: receipt,
        sender_account_id: options.payer || payer,
        wait_until: 'FINAL',
      });
    } catch (err: any) {
      return {
        ok: false,
        code: 'TX_NOT_FOUND',
        error: String(err?.message || err).slice(0, 200),
      };
    }

    const event = findEvent(tx, 'charge_executed', options.vault);
    if (!event) {
      return {
        ok: false,
        code: 'PAYMENT_NOT_FOUND',
        error: 'No charge_executed event in this transaction.',
      };
    }
    const data = event.data || {};
    if (Number(data.tab_id) !== invoice.tabId) {
      return {
        ok: false,
        code: 'WRONG_TAB',
        error: `Expected Tab #${invoice.tabId}.`,
      };
    }
    if (data.spender !== payer) {
      return {
        ok: false,
        code: 'WRONG_PAYER',
        error: 'The receipt was not paid by this payer.',
      };
    }
    if (data.receiver_id !== invoice.payTo) {
      return {
        ok: false,
        code: 'WRONG_RECEIVER',
        error: 'The receipt paid a different receiver.',
      };
    }
    if (data.token !== invoice.asset) {
      return {
        ok: false,
        code: 'WRONG_ASSET',
        error: 'The receipt used a different asset.',
      };
    }
    if (String(data.amount) !== invoice.amount) {
      return {
        ok: false,
        code: 'WRONG_AMOUNT',
        error: `Expected ${invoice.amount} atomic units, got ${data.amount}.`,
      };
    }
    // Check replay only after the receipt's payer, receiver, asset and amount
    // have been validated. This lets a wrong payer receive WRONG_PAYER instead
    // of a generic replay error, without letting a used receipt through.
    if (usedReceipts.has(receipt)) {
      return {
        ok: false,
        code: 'RECEIPT_REPLAY',
        error: 'This payment receipt was already used.',
        replay: true,
      };
    }
    if (String(data.reference) !== invoice.reference) {
      return {
        ok: false,
        code: 'WRONG_REFERENCE',
        error: 'The receipt was not paid for this invoice.',
      };
    }
    return { ok: true, event };
  }

  function challenge(url: string, invoice: Invoice) {
    return {
      x402Version: 1,
      error: 'Payment required',
      accepts: [
        {
          scheme: 'tabwrit',
          network,
          maxAmountRequired: invoice.amount,
          resource: url,
          description,
          mimeType: 'application/json',
          payTo: invoice.payTo,
          maxTimeoutSeconds: invoiceTtlSeconds,
          asset: invoice.asset,
          extra: {
            tabId: invoice.tabId,
            vault: options.vault,
            invoiceId: invoice.id,
            reference: invoice.reference,
            name: 'TabWrit',
            version: '1.0.0',
            note: 'x402-style TabWrit challenge, not a full x402 implementation',
          },
        },
      ],
    };
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'content-type,x-tab-receipt,x-tab-payer,x-tab-invoice,x-tab-tab',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      });
      res.end();
      return;
    }

    const requestUrl = new URL(
      req.url || '/',
      `http://${req.headers.host || host}`
    );
    if (req.method !== 'GET' || requestUrl.pathname !== resourcePath) {
      json(res, 404, { error: 'Not found' });
      return;
    }

    const receipt = String(req.headers['x-tab-receipt'] || '').trim();
    if (!receipt) {
      const invoice = createInvoice(requestUrl.toString());
      json(res, 402, challenge(requestUrl.toString(), invoice));
      return;
    }

    const payer = String(req.headers['x-tab-payer'] || '').trim();
    if (!isAccountId(payer)) {
      json(res, 400, {
        error: 'Missing or invalid X-Tab-Payer header.',
        code: 'PAYER_REQUIRED',
      });
      return;
    }

    const invoiceId = String(req.headers['x-tab-invoice'] || '').trim();
    if (!invoiceId) {
      json(res, 400, {
        error: 'Missing X-Tab-Invoice header.',
        code: 'INVOICE_REQUIRED',
      });
      return;
    }

    const invoice = invoices.get(invoiceId);
    if (!invoice) {
      json(res, 402, {
        error: 'Unknown invoice. Request a new 402 challenge.',
        code: 'INVOICE_NOT_FOUND',
      });
      return;
    }
    if (invoice.used) {
      json(res, 409, {
        error: 'This invoice was already paid and consumed.',
        code: 'INVOICE_ALREADY_PAID',
      });
      return;
    }
    if (Date.now() > invoice.expiresAt) {
      json(res, 402, {
        error: 'This invoice expired. Request a new 402 challenge.',
        code: 'INVOICE_EXPIRED',
      });
      return;
    }
    const verification = await verifyReceipt(receipt, payer, invoice);
    if (!verification.ok) {
      if (verification.replay) {
        json(res, 409, {
          error: verification.error || 'This payment receipt was already used.',
          code: verification.code || 'RECEIPT_REPLAY',
        });
        return;
      }
      json(res, 402, {
        ...challenge(requestUrl.toString(), invoice),
        error: verification.error || 'Payment could not be verified.',
        code: verification.code || 'PAYMENT_NOT_VERIFIED',
      });
      return;
    }

    // Consume the invoice and the receipt only after a successful on-chain
    // verification.
    invoice.used = true;
    usedReceipts.add(receipt);

    const [blockHeight, stats] = await Promise.all([
      getBlockHeight(),
      view(options.vault, 'get_stats', { token: invoice.asset }),
    ]);

    json(res, 200, {
      report: 'TabWrit premium NEAR testnet report',
      network,
      generated_at: new Date().toISOString(),
      block_height: blockHeight,
      vault: options.vault,
      token: invoice.asset,
      stats: {
        total_tabs: Number(stats.total_tabs),
        total_charges: Number(stats.total_charges),
        total_volume: String(stats.total_volume),
      },
      paid: {
        tx_hash: receipt,
        invoice_id: invoice.id,
        payer,
        tab_id: invoice.tabId,
        amount: invoice.amount,
        asset: invoice.asset,
        receiver: invoice.payTo,
        reference: invoice.reference,
      },
    });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: any) => {
      json(res, 502, {
        error: String(err?.message || err).slice(0, 240),
        code: 'UPSTREAM_RPC_ERROR',
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const actualPort =
    typeof address === 'object' && address ? address.port : port;

  return {
    server,
    url: `http://${host}:${actualPort}${resourcePath}`,
    usedReceipts,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
