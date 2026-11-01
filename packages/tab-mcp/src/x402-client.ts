/**
 * x402-style paid-fetch client for TabWrit.
 *
 * The client reads an HTTP 402 challenge, binds the payment to the challenge
 * invoice, preflights the Tab, submits a real `charge` transaction with the
 * agent's scoped key, and only then retries the request with the on-chain
 * receipt. The contract remains the authority: the preflight is a gas-saving
 * safety layer, not the security boundary.
 */
import { TabNearClient, TabEvent } from './near-client.js';

export interface X402Accept {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset: string;
  extra?: {
    tabId?: number;
    vault?: string;
    invoiceId?: string;
    reference?: string;
    name?: string;
    version?: string;
    note?: string;
    [key: string]: unknown;
  };
}

export interface X402Challenge {
  x402Version: number;
  error?: string;
  accepts: X402Accept[];
  code?: string;
}

export interface PayAndFetchOptions {
  url: string;
  tabId: number;
  maxAmount?: string;
  allowedHosts?: string[];
  timeoutMs?: number;
}

export interface PayAndFetchResult {
  status: 'PAID' | 'FREE' | 'REJECTED' | 'REFUSED' | 'FAILED' | 'ERROR';
  reason?: string;
  detail?: string;
  txHash?: string;
  explorerUrl?: string;
  invoiceId?: string;
  challenge?: X402Challenge;
  report?: unknown;
  httpStatus?: number;
  payment?: {
    tabId: number;
    amount: string;
    asset: string;
    payTo: string;
    reference: string;
    nonce: number;
  };
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function isAccountId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.length <= 64 &&
    /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value)
  );
}

function isPositiveInteger(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n;
}

function configuredHosts(): string[] {
  const raw = process.env.TAB_X402_ALLOWED_HOSTS || '127.0.0.1,localhost';
  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase();
}

function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = normalizeHost(hostname);
  return allowedHosts.some((entry) => {
    const normalized = normalizeHost(entry);
    if (normalized.startsWith('*.')) {
      return host.endsWith(normalized.slice(1));
    }
    return host === normalized;
  });
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ status: number; body: any; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
    const text = await response.text();
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: response.status, body, text };
  } finally {
    clearTimeout(timer);
  }
}

function sameResource(requested: string, quoted: string): boolean {
  try {
    const a = new URL(requested);
    const b = new URL(quoted);
    return (
      a.origin === b.origin && a.pathname === b.pathname && a.search === b.search
    );
  } catch {
    return false;
  }
}

function normalizeReason(reason: unknown): string | undefined {
  if (typeof reason !== 'string' || !reason) return undefined;
  if (reason.includes('_')) return reason;
  return reason
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
}

function eventReason(events: TabEvent[]): {
  executed?: TabEvent;
  rejected?: TabEvent;
  failed?: TabEvent;
  reason?: string;
} {
  const executed = events.find((event) => event.event === 'charge_executed');
  const rejected = events.find((event) => event.event === 'charge_rejected');
  const failed = events.find((event) => event.event === 'charge_failed');
  return {
    executed,
    rejected,
    failed,
    reason:
      normalizeReason(rejected?.data?.reason) ||
      normalizeReason(failed?.data?.reason),
  };
}

function refusal(reason: string, detail: string): PayAndFetchResult {
  return { status: 'REFUSED', reason, detail };
}

/**
 * Preflight the Tab before spending gas. The contract re-checks every one of
 * these rules and remains the actual enforcement point.
 */
async function preflight(
  client: TabNearClient,
  tabId: number,
  accept: X402Accept
): Promise<PayAndFetchResult | null> {
  const tab = await client.getTab(tabId);
  if (!tab) return refusal('TAB_NOT_FOUND', `Tab #${tabId} does not exist.`);
  if (tab.spender !== client.accountId) {
    return refusal(
      'NOT_SPENDER',
      `Tab #${tabId} is assigned to ${tab.spender}, not ${client.accountId}.`
    );
  }
  if (tab.status !== 'Active') {
    return refusal(
      'TAB_NOT_ACTIVE',
      `Tab #${tabId} status is ${String(tab.status)}.`
    );
  }
  if (BigInt(Date.now()) * 1_000_000n >= BigInt(tab.expires_at_ns)) {
    return refusal('TAB_EXPIRED', `Tab #${tabId} has expired.`);
  }
  if (accept.asset !== tab.token) {
    return refusal(
      'WRONG_ASSET',
      `The challenge asks for ${accept.asset}; the Tab pays ${tab.token}.`
    );
  }
  if (!(await client.isTokenAllowed(accept.asset))) {
    return refusal(
      'TOKEN_NOT_ALLOWED',
      `${accept.asset} is not allowlisted by the vault.`
    );
  }

  const amount = BigInt(accept.maxAmountRequired);
  if (amount > BigInt(tab.per_charge_cap)) {
    return refusal(
      'PER_CHARGE_CAP',
      `The invoice is ${amount} atomic units; the Tab per-charge cap is ${tab.per_charge_cap}.`
    );
  }

  const remaining = await client.getRemainingAllowance(tabId);
  if (!remaining) {
    return refusal('TAB_NOT_ACTIVE', `Tab #${tabId} has no remaining allowance.`);
  }
  if (amount > BigInt(remaining.remaining_in_period)) {
    return refusal(
      'PERIOD_CAP',
      `The invoice is ${amount}; the period allowance is ${remaining.remaining_in_period}.`
    );
  }
  if (amount > BigInt(remaining.remaining_total)) {
    return refusal(
      'TOTAL_CAP',
      `The invoice is ${amount}; the lifetime allowance is ${remaining.remaining_total}.`
    );
  }

  if (
    tab.receiver_policy &&
    typeof tab.receiver_policy === 'object' &&
    Array.isArray(tab.receiver_policy.Allowlist) &&
    !tab.receiver_policy.Allowlist.includes(accept.payTo)
  ) {
    return refusal(
      'RECEIVER_NOT_ALLOWED',
      `Tab #${tabId} may only pay ${tab.receiver_policy.Allowlist.join(', ')}; the challenge asks for ${accept.payTo}.`
    );
  }

  const balance = BigInt(await client.getVaultBalance(tab.owner, tab.token));
  if (amount > balance) {
    return refusal(
      'INSUFFICIENT_BALANCE',
      `The vault ledger has ${balance}; the invoice is ${amount}.`
    );
  }

  return null;
}

export async function payAndFetch(
  client: TabNearClient,
  options: PayAndFetchOptions
): Promise<PayAndFetchResult> {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    return refusal('INVALID_URL', 'The resource URL is not valid.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return refusal(
      'UNSUPPORTED_PROTOCOL',
      'Only http:// and https:// resources are supported.'
    );
  }

  const allowedHosts = options.allowedHosts || configuredHosts();
  if (!isHostAllowed(url.hostname, allowedHosts)) {
    return refusal(
      'HOST_NOT_ALLOWED',
      `${url.hostname} is not in TAB_X402_ALLOWED_HOSTS (${allowedHosts.join(', ')}).`
    );
  }
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(normalizeHost(url.hostname))) {
    return refusal(
      'INSECURE_TRANSPORT',
      'Plain HTTP is only allowed for localhost. Use HTTPS for a remote paid API.'
    );
  }

  const timeoutMs = options.timeoutMs ?? 20000;

  let initial: { status: number; body: any; text: string };
  try {
    initial = await fetchJson(
      url.toString(),
      { method: 'GET', headers: { accept: 'application/json' } },
      timeoutMs
    );
  } catch (err: any) {
    return {
      status: 'ERROR',
      reason: 'NETWORK_ERROR',
      detail: String(err?.message || err).slice(0, 240),
    };
  }

  if (initial.status === 200) {
    return {
      status: 'FREE',
      httpStatus: 200,
      report: initial.body ?? initial.text,
    };
  }
  if (initial.status !== 402) {
    return {
      status: 'ERROR',
      reason: `HTTP_${initial.status}`,
      httpStatus: initial.status,
      detail: initial.body?.error || initial.text.slice(0, 240),
    };
  }

  const challenge = initial.body as X402Challenge;
  if (!challenge || challenge.x402Version !== 1 || !Array.isArray(challenge.accepts)) {
    return {
      status: 'ERROR',
      reason: 'INVALID_CHALLENGE',
      httpStatus: 402,
      detail: 'The resource did not return a valid x402Version 1 challenge.',
    };
  }

  const accept = challenge.accepts.find(
    (candidate) =>
      candidate?.scheme === 'tabwrit' &&
      candidate?.network === client.networkId &&
      isAccountId(candidate?.payTo) &&
      isAccountId(candidate?.asset) &&
      isPositiveInteger(candidate?.maxAmountRequired)
  );
  if (!accept) {
    return {
      status: 'REFUSED',
      reason: 'NO_SUPPORTED_ACCEPT',
      challenge,
      httpStatus: 402,
      detail: `No tabwrit/${client.networkId} payment option in the challenge.`,
    };
  }
  if (!sameResource(url.toString(), accept.resource)) {
    return {
      status: 'REFUSED',
      reason: 'RESOURCE_MISMATCH',
      challenge,
      httpStatus: 402,
      detail: 'The challenge resource does not match the requested URL.',
    };
  }
  if (accept.extra?.tabId !== undefined && Number(accept.extra.tabId) !== options.tabId) {
    return {
      status: 'REFUSED',
      reason: 'WRONG_TAB',
      challenge,
      httpStatus: 402,
      detail: `The challenge expects Tab #${accept.extra.tabId}, not #${options.tabId}.`,
    };
  }
  const invoiceId = String(accept.extra?.invoiceId || '').trim();
  if (!invoiceId) {
    return {
      status: 'REFUSED',
      reason: 'INVOICE_REQUIRED',
      challenge,
      httpStatus: 402,
      detail: 'The challenge has no invoice ID, so the payment cannot be bound to it.',
    };
  }
  if (options.maxAmount && BigInt(accept.maxAmountRequired) > BigInt(options.maxAmount)) {
    return {
      status: 'REFUSED',
      reason: 'MAX_AMOUNT_EXCEEDED',
      challenge,
      httpStatus: 402,
      detail: `The invoice is ${accept.maxAmountRequired}; the caller limit is ${options.maxAmount}.`,
    };
  }

  let preflightResult: PayAndFetchResult | null;
  try {
    preflightResult = await preflight(client, options.tabId, accept);
  } catch (err: any) {
    return {
      status: 'ERROR',
      reason: 'PREFLIGHT_FAILED',
      challenge,
      detail: String(err?.message || err).slice(0, 240),
    };
  }
  if (preflightResult) {
    return { ...preflightResult, challenge, invoiceId };
  }

  const reference = String(accept.extra?.reference || `x402:${invoiceId}`);
  let charge: Awaited<ReturnType<TabNearClient['charge']>>;
  try {
    charge = await client.charge(
      options.tabId,
      accept.maxAmountRequired,
      accept.payTo,
      reference
    );
  } catch (err: any) {
    return {
      status: 'ERROR',
      reason: 'CHARGE_SUBMISSION_FAILED',
      challenge,
      invoiceId,
      detail: String(err?.message || err).slice(0, 240),
    };
  }

  const payment = {
    tabId: options.tabId,
    amount: accept.maxAmountRequired,
    asset: accept.asset,
    payTo: accept.payTo,
    reference,
    nonce: charge.nonce,
  };
  const outcome = eventReason(charge.events);

  if (outcome.rejected) {
    return {
      status: 'REJECTED',
      reason: outcome.reason || 'CHARGE_REJECTED',
      challenge,
      invoiceId,
      txHash: charge.txHash,
      explorerUrl: `https://testnet.nearblocks.io/txns/${charge.txHash}`,
      payment,
      detail: 'The contract rejected the charge; no funds moved.',
    };
  }
  if (outcome.failed) {
    return {
      status: 'FAILED',
      reason: outcome.reason || 'CHARGE_FAILED',
      challenge,
      invoiceId,
      txHash: charge.txHash,
      explorerUrl: `https://testnet.nearblocks.io/txns/${charge.txHash}`,
      payment,
      detail: 'The transfer failed; the vault restored the accounting.',
    };
  }
  if (!outcome.executed) {
    return {
      status: 'ERROR',
      reason: 'NO_CHARGE_EVENT',
      challenge,
      invoiceId,
      txHash: charge.txHash,
      explorerUrl: `https://testnet.nearblocks.io/txns/${charge.txHash}`,
      payment,
      detail: 'The transaction did not emit charge_executed, charge_rejected or charge_failed.',
    };
  }

  let paid: { status: number; body: any; text: string };
  try {
    paid = await fetchJson(
      url.toString(),
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-tab-receipt': charge.txHash,
          'x-tab-payer': client.accountId,
          'x-tab-invoice': invoiceId,
        },
      },
      timeoutMs
    );
  } catch (err: any) {
    return {
      status: 'ERROR',
      reason: 'PAID_BUT_FETCH_FAILED',
      challenge,
      invoiceId,
      txHash: charge.txHash,
      explorerUrl: `https://testnet.nearblocks.io/txns/${charge.txHash}`,
      payment,
      detail: String(err?.message || err).slice(0, 240),
    };
  }

  if (paid.status !== 200) {
    return {
      status: 'ERROR',
      reason: paid.body?.code || `HTTP_${paid.status}`,
      challenge,
      invoiceId,
      txHash: charge.txHash,
      explorerUrl: `https://testnet.nearblocks.io/txns/${charge.txHash}`,
      payment,
      httpStatus: paid.status,
      detail:
        paid.body?.error ||
        'The API did not return data after the on-chain payment was confirmed.',
    };
  }

  return {
    status: 'PAID',
    httpStatus: 200,
    challenge,
    invoiceId,
    txHash: charge.txHash,
    explorerUrl: `https://testnet.nearblocks.io/txns/${charge.txHash}`,
    report: paid.body ?? paid.text,
    payment,
  };
}
