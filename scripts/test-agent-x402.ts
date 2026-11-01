/**
 * Real x402-style agent API payment on NEAR testnet.
 *
 * Flow:
 *   1. The demo owner creates a Tab for `tab-agent.testnet` with a receiver
 *      allowlist containing only the merchant.
 *   2. A local paid API returns a real HTTP 402 challenge with an invoice.
 *   3. The MCP agent tool `tab_pay_and_fetch` preflights the Tab, charges the
 *      invoice with the agent's scoped key, and fetches the data with the
 *      on-chain receipt.
 *   4. The API verifies the `charge_executed` event, the Tab, payer, receiver,
 *      asset, amount and invoice reference before returning any data.
 *   5. The test also proves replay protection, wrong-payer/wrong-amount
 *      rejection, receiver-allowlist containment, per-charge cap rejection and
 *      revocation containment.
 *
 * No mocks. Every payment and every rejection is a real NEAR testnet
 * transaction. The local HTTP servers bind to 127.0.0.1.
 *
 * Usage: pnpm test:x402
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as nearAPI from 'near-api-js';
import { startX402Api, X402Api } from './x402-api.js';
import { TabNearClient, TabEvent } from '../packages/tab-mcp/src/near-client.js';

const { connect, keyStores, KeyPair, providers } = nearAPI;

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const VAULT = process.env.TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet';
const TOKEN = process.env.TAB_TOKEN_ID || 'tab-usdc.testnet';
const OWNER = process.env.TESTNET_DEMO_ACCOUNT_ID || 'tab-demo.testnet';
const OWNER_KEY = process.env.TESTNET_DEMO_PRIVATE_KEY;
const AGENT = process.env.TESTNET_AGENT_ACCOUNT_ID || 'tab-agent.testnet';
const AGENT_KEY = process.env.TESTNET_AGENT_CHARGE_PRIVATE_KEY;
const MERCHANT = process.env.MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';
const ATTACKER = process.env.ATTACKER_ACCOUNT_ID || 'tab-attacker.testnet';

if (!OWNER_KEY || !AGENT_KEY) {
  console.error('Missing TESTNET_DEMO_PRIVATE_KEY or TESTNET_AGENT_CHARGE_PRIVATE_KEY in .env.');
  process.exit(1);
}

const U = 1_000_000n;
const INVOICE_AMOUNT = 500_000n; // 0.5 tUSDC
const OVER_CAP_AMOUNT = 2n * U; // 2 tUSDC, above the 1 tUSDC per-charge cap
const MIN_STORAGE = BigInt('10000000000000000000000'); // 0.01 NEAR
const GAS = BigInt('50000000000000');

const provider = new providers.JsonRpcProvider({ url: RPC });
const results: Array<{
  id: string;
  name: string;
  pass: boolean;
  detail: string;
  tx?: string;
}> = [];

function record(id: string, name: string, pass: boolean, detail: string, tx?: string) {
  results.push({ id, name, pass, detail, tx });
  console.log(
    `[${pass ? 'PASS' : 'FAIL'}] ${id.padEnd(5)} ${name.padEnd(58)} ${detail}${
      tx ? ` tx=${tx.slice(0, 10)}...` : ''
    }`
  );
}

function explorer(tx: string) {
  return `https://testnet.nearblocks.io/txns/${tx}`;
}

async function view<T = any>(
  contract: string,
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const res: any = await provider.query({
    request_type: 'call_function',
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    finality: 'optimistic',
  });
  return JSON.parse(Buffer.from(res.result).toString('utf8')) as T;
}

async function tokenBalance(account: string): Promise<bigint> {
  return BigInt(await view<string>(TOKEN, 'ft_balance_of', { account_id: account }));
}

async function vaultBalance(owner: string): Promise<bigint> {
  return BigInt(await view<string>(VAULT, 'get_balance', { owner, token: TOKEN }));
}

async function nearBalance(account: string): Promise<bigint> {
  const state = await provider.query({
    request_type: 'view_account',
    finality: 'final',
    account_id: account,
  });
  return BigInt((state as any).amount);
}

async function getTab(tabId: number): Promise<any> {
  for (let i = 0; i < 15; i++) {
    const tab = await view<any>(VAULT, 'get_tab', { tab_id: tabId });
    if (tab) return tab;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Tab #${tabId} not visible on-chain`);
}

async function accountFor(accountId: string, privateKey: string) {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', accountId, KeyPair.fromString(privateKey as never));
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore });
  return near.account(accountId);
}

async function ensureOwnerFunds(owner: nearAPI.Account) {
  const near = await nearBalance(OWNER);
  if (near < BigInt('200000000000000000000000')) {
    throw new Error(
      `Owner ${OWNER} has only ${(Number(near) / 1e24).toFixed(4)} NEAR; at least 0.2 NEAR is required for Tab storage and gas.`
    );
  }

  let wallet = await tokenBalance(OWNER);
  if (wallet < 10n * U) {
    console.log('[prep] demo tUSDC low; calling the public faucet...');
    await owner.functionCall({
      contractId: TOKEN,
      methodName: 'faucet',
      args: {},
      gas: BigInt('30000000000000'),
      attachedDeposit: BigInt(0),
    });
    wallet = await tokenBalance(OWNER);
  }

  const ledger = await vaultBalance(OWNER);
  if (ledger < 5n * U) {
    console.log('[prep] depositing 10 tUSDC into the demo vault...');
    const tx = await owner.functionCall({
      contractId: TOKEN,
      methodName: 'ft_transfer_call',
      args: { receiver_id: VAULT, amount: (10n * U).toString(), msg: '' },
      gas: GAS,
      attachedDeposit: BigInt(1),
    });
    console.log(`[prep] deposit: ${explorer(tx.transaction.hash)}`);
  }
}

async function createTab(owner: nearAPI.Account): Promise<{ tabId: number; txHash: string }> {
  const outcome: any = await owner.functionCall({
    contractId: VAULT,
    methodName: 'create_tab',
    args: {
      spender: AGENT,
      token: TOKEN,
      per_charge_cap: (1n * U).toString(),
      per_period_cap: (5n * U).toString(),
      total_cap: (10n * U).toString(),
      period_secs: 86400,
      expires_at_ns: Math.floor((Date.now() + 24 * 60 * 60 * 1000) * 1_000_000),
      receiver_policy: { Allowlist: [MERCHANT] },
      label: 'x402 agent API — Cloudline',
    },
    gas: GAS,
    attachedDeposit: MIN_STORAGE,
  });

  const raw = Buffer.from(outcome.status.SuccessValue || '', 'base64').toString('utf8');
  const tabId = Number(JSON.parse(raw));
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error(`create_tab returned ${raw}`);
  }
  console.log(`[prep] Tab #${tabId}: ${explorer(outcome.transaction.hash)}`);
  return { tabId, txHash: outcome.transaction.hash };
}

interface McpSession {
  request: (method: string, params: unknown) => Promise<any>;
  close: () => void;
}

async function startMcpSession(): Promise<McpSession> {
  const serverPath = path.resolve('packages/tab-mcp/dist/index.js');
  const proc = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEAR_NETWORK: 'testnet',
      NEAR_RPC_URL: RPC,
      NEAR_ACCOUNT_ID: AGENT,
      NEAR_PRIVATE_KEY: AGENT_KEY,
      TAB_VAULT_CONTRACT_ID: VAULT,
      TAB_TOKEN_ID: TOKEN,
      TAB_X402_ALLOWED_HOSTS: '127.0.0.1,localhost',
    },
  });

  let buffer = '';
  let nextId = 1;
  const waiting = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }
  >();

  proc.stdout.on('data', (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        const waiter = waiting.get(message.id);
        if (waiter) {
          clearTimeout(waiter.timer);
          waiting.delete(message.id);
          waiter.resolve(message);
        }
      } catch {
        // ignore non-JSON stdout lines
      }
    }
  });

  function request(method: string, params: unknown): Promise<any> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`MCP timeout waiting for ${method} (id=${id})`));
      }, 90000);
      waiting.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'TabWrit-X402-Verifier', version: '1.0' },
  });

  return {
    request,
    close: () => {
      for (const waiter of waiting.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('MCP session closed'));
      }
      waiting.clear();
      proc.kill();
    },
  };
}

async function callMcpTool(
  session: McpSession,
  name: string,
  args: Record<string, unknown>
): Promise<{ parsed: any; isError: boolean; text: string }> {
  const response = await session.request('tools/call', { name, arguments: args });
  const text = response.result?.content?.[0]?.text;
  if (!text) throw new Error(`MCP returned no text: ${JSON.stringify(response)}`);
  return {
    parsed: JSON.parse(text),
    isError: Boolean(response.result?.isError),
    text,
  };
}

interface HttpResult {
  status: number;
  body: any;
}

async function getChallenge(url: string): Promise<HttpResult> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function paidFetch(
  url: string,
  receipt: string,
  payer: string,
  invoiceId: string
): Promise<HttpResult> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-tab-receipt': receipt,
      'x-tab-payer': payer,
      'x-tab-invoice': invoiceId,
    },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

function findEvent(events: TabEvent[], name: string): TabEvent | undefined {
  return events.find((event) => event.event === name);
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 30000,
  intervalMs = 1000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

let mcp: McpSession | undefined;
const apis: X402Api[] = [];

async function main() {
  console.log('='.repeat(112));
  console.log(' TABWRIT — x402-STYLE AGENT API PAYMENT (real NEAR testnet)');
  console.log(` Owner:   ${OWNER}`);
  console.log(` Agent:   ${AGENT} (scoped charge key)`);
  console.log(` Payee:   ${MERCHANT}`);
  console.log(` Attacker:${ATTACKER}`);
  console.log(` Vault:   ${VAULT}`);
  console.log(` Token:   ${TOKEN}`);
  console.log('='.repeat(112));

  // Make the in-process TabNearClient explicit about the agent identity.
  process.env.NEAR_NETWORK = 'testnet';
  process.env.NEAR_RPC_URL = RPC;
  process.env.NEAR_ACCOUNT_ID = AGENT;
  process.env.NEAR_PRIVATE_KEY = AGENT_KEY;
  process.env.TAB_VAULT_CONTRACT_ID = VAULT;
  process.env.TAB_TOKEN_ID = TOKEN;

  const owner = await accountFor(OWNER, OWNER_KEY as string);
  await ensureOwnerFunds(owner);
  const { tabId } = await createTab(owner);
  await new Promise((r) => setTimeout(r, 1500));

  const legitApi = await startX402Api({
    payTo: MERCHANT,
    asset: TOKEN,
    amount: INVOICE_AMOUNT.toString(),
    tabId,
    vault: VAULT,
    payer: AGENT,
    host: '127.0.0.1',
    port: 0,
    description: 'Cloudline premium NEAR testnet report',
  });
  apis.push(legitApi);

  const attackerApi = await startX402Api({
    payTo: ATTACKER,
    asset: TOKEN,
    amount: INVOICE_AMOUNT.toString(),
    tabId,
    vault: VAULT,
    payer: AGENT,
    host: '127.0.0.1',
    port: 0,
    description: 'Prompt-injected paid API',
  });
  apis.push(attackerApi);

  const overCapApi = await startX402Api({
    payTo: MERCHANT,
    asset: TOKEN,
    amount: OVER_CAP_AMOUNT.toString(),
    tabId,
    vault: VAULT,
    payer: AGENT,
    host: '127.0.0.1',
    port: 0,
    description: 'Over-cap paid API',
  });
  apis.push(overCapApi);

  const wrongAmountApi = await startX402Api({
    payTo: MERCHANT,
    asset: TOKEN,
    amount: (INVOICE_AMOUNT + 100_000n).toString(),
    tabId,
    vault: VAULT,
    payer: AGENT,
    host: '127.0.0.1',
    port: 0,
    description: 'Tampered-amount paid API',
  });
  apis.push(wrongAmountApi);

  mcp = await startMcpSession();

  // X1 — real 402 challenge
  const challenge = await getChallenge(legitApi.url);
  const accept = challenge.body?.accepts?.[0];
  const challengePass =
    challenge.status === 402 &&
    challenge.body?.x402Version === 1 &&
    accept?.scheme === 'tabwrit' &&
    accept?.network === 'testnet' &&
    accept?.payTo === MERCHANT &&
    accept?.asset === TOKEN &&
    accept?.maxAmountRequired === INVOICE_AMOUNT.toString() &&
    accept?.resource === legitApi.url &&
    typeof accept?.extra?.invoiceId === 'string' &&
    accept.extra.invoiceId.length === 32 &&
    Number(accept?.extra?.tabId) === tabId;
  record(
    'X1',
    'Unpaid request returns a real 402 TabWrit challenge',
    challengePass,
    `status=${challenge.status} invoice=${String(accept?.extra?.invoiceId || '').slice(0, 8)}... payTo=${accept?.payTo}`
  );

  // X2 — MCP pays and fetches
  const merchantBefore = await tokenBalance(MERCHANT);
  const vaultBefore = await vaultBalance(OWNER);
  const successful = await callMcpTool(mcp, 'tab_pay_and_fetch', {
    url: legitApi.url,
    tab_id: tabId,
  });
  const paid = successful.parsed;
  const successTx = String(paid.txHash || '');

  const stateSettled = await waitFor(async () => {
    const tab = await getTab(tabId);
    const merchantAfter = await tokenBalance(MERCHANT);
    const vaultAfter = await vaultBalance(OWNER);
    return (
      BigInt(tab.spent_total) === INVOICE_AMOUNT &&
      Number(tab.charge_count) === 1 &&
      Number(tab.next_nonce) === 1 &&
      merchantAfter === merchantBefore + INVOICE_AMOUNT &&
      vaultAfter === vaultBefore - INVOICE_AMOUNT
    );
  });
  const tabAfter = await getTab(tabId);
  const merchantAfter = await tokenBalance(MERCHANT);
  const vaultAfter = await vaultBalance(OWNER);

  record(
    'X2a',
    'MCP tab_pay_and_fetch returns PAID and the live report',
    paid.status === 'PAID' &&
      typeof paid.report === 'object' &&
      paid.report?.paid?.tx_hash === successTx &&
      paid.report?.paid?.receiver === MERCHANT &&
      paid.report?.paid?.amount === INVOICE_AMOUNT.toString() &&
      Number(paid.report?.paid?.tab_id) === tabId &&
      paid.report?.paid?.invoice_id === paid.invoiceId &&
      paid.report?.paid?.reference === `x402:${paid.invoiceId}`,
    `status=${paid.status} report=${paid.report?.report || 'none'}`,
    successTx
  );

  record(
    'X2b',
    'On-chain Tab counters and tUSDC movement match the invoice',
    stateSettled &&
      BigInt(tabAfter.spent_total) === INVOICE_AMOUNT &&
      Number(tabAfter.charge_count) === 1 &&
      Number(tabAfter.next_nonce) === 1 &&
      merchantAfter === merchantBefore + INVOICE_AMOUNT &&
      vaultAfter === vaultBefore - INVOICE_AMOUNT,
    `merchant ${merchantBefore} -> ${merchantAfter}; vault ${vaultBefore} -> ${vaultAfter}; nonce=${tabAfter.next_nonce}`,
    successTx
  );

  const successInvoiceId = String(paid.invoiceId || '');

  // X3 — receipt replay with a fresh invoice
  const freshChallenge = await getChallenge(legitApi.url);
  const freshInvoiceId = String(freshChallenge.body?.accepts?.[0]?.extra?.invoiceId || '');
  const replay = await paidFetch(legitApi.url, successTx, AGENT, freshInvoiceId);
  record(
    'X3',
    'A used receipt is rejected with RECEIPT_REPLAY on a fresh invoice',
    replay.status === 409 && replay.body?.code === 'RECEIPT_REPLAY',
    `status=${replay.status} code=${replay.body?.code || 'none'}`
  );

  // X4 — invoice consumption
  const sameInvoice = await paidFetch(legitApi.url, successTx, AGENT, successInvoiceId);
  record(
    'X4',
    'A consumed invoice is rejected with INVOICE_ALREADY_PAID',
    sameInvoice.status === 409 && sameInvoice.body?.code === 'INVOICE_ALREADY_PAID',
    `status=${sameInvoice.status} code=${sameInvoice.body?.code || 'none'}`
  );

  // X5 — wrong payer
  const wrongPayerChallenge = await getChallenge(legitApi.url);
  const wrongPayerInvoice = String(
    wrongPayerChallenge.body?.accepts?.[0]?.extra?.invoiceId || ''
  );
  const wrongPayer = await paidFetch(legitApi.url, successTx, ATTACKER, wrongPayerInvoice);
  record(
    'X5',
    'A receipt presented by a different payer is rejected',
    wrongPayer.status === 402 && wrongPayer.body?.code === 'WRONG_PAYER',
    `status=${wrongPayer.status} code=${wrongPayer.body?.code || 'none'}`
  );

  // X6 — wrong amount
  const wrongAmountChallenge = await getChallenge(wrongAmountApi.url);
  const wrongAmountInvoice = String(
    wrongAmountChallenge.body?.accepts?.[0]?.extra?.invoiceId || ''
  );
  const wrongAmount = await paidFetch(
    wrongAmountApi.url,
    successTx,
    AGENT,
    wrongAmountInvoice
  );
  record(
    'X6',
    'A receipt for a different amount is rejected',
    wrongAmount.status === 402 && wrongAmount.body?.code === 'WRONG_AMOUNT',
    `status=${wrongAmount.status} code=${wrongAmount.body?.code || 'none'}`
  );

  const attackerBefore = await tokenBalance(ATTACKER);
  const nonceBeforeAttacks = Number((await getTab(tabId)).next_nonce);

  // X7 — prompt-injected receiver: client refuses, contract also rejects
  const attackerChallenge = await getChallenge(attackerApi.url);
  const attackerAccept = attackerChallenge.body?.accepts?.[0];
  const attackTool = await callMcpTool(mcp, 'tab_pay_and_fetch', {
    url: attackerApi.url,
    tab_id: tabId,
  });
  record(
    'X7a',
    'Agent client refuses a prompt-injected receiver before spending gas',
    attackerAccept?.payTo === ATTACKER &&
      attackTool.parsed.status === 'REFUSED' &&
      attackTool.parsed.reason === 'RECEIVER_NOT_ALLOWED' &&
      !attackTool.parsed.txHash,
    `status=${attackTool.parsed.status} reason=${attackTool.parsed.reason || 'none'}`
  );

  const agentClient = new TabNearClient();
  const attackCharge = await agentClient.charge(
    tabId,
    INVOICE_AMOUNT.toString(),
    ATTACKER,
    'x402:attacker-redirect'
  );
  const attackRejected = findEvent(attackCharge.events, 'charge_rejected');
  record(
    'X7b',
    'Contract rejects the same redirect with RECEIVER_NOT_ALLOWED',
    Boolean(attackRejected) &&
      attackRejected?.data?.reason === 'RECEIVER_NOT_ALLOWED' &&
      (await tokenBalance(ATTACKER)) === attackerBefore &&
      Number((await getTab(tabId)).next_nonce) === nonceBeforeAttacks,
    `reason=${attackRejected?.data?.reason || 'none'} attacker=${attackerBefore}`,
    attackCharge.txHash
  );

  // X8 — over-cap invoice: client refuses, contract also rejects
  const overCapChallenge = await getChallenge(overCapApi.url);
  const overCapAccept = overCapChallenge.body?.accepts?.[0];
  const overCapTool = await callMcpTool(mcp, 'tab_pay_and_fetch', {
    url: overCapApi.url,
    tab_id: tabId,
  });
  record(
    'X8a',
    'Agent client refuses an invoice above the per-charge cap',
    overCapAccept?.maxAmountRequired === OVER_CAP_AMOUNT.toString() &&
      overCapTool.parsed.status === 'REFUSED' &&
      overCapTool.parsed.reason === 'PER_CHARGE_CAP' &&
      !overCapTool.parsed.txHash,
    `status=${overCapTool.parsed.status} reason=${overCapTool.parsed.reason || 'none'}`
  );

  const merchantBeforeOverCap = await tokenBalance(MERCHANT);
  const overCapCharge = await agentClient.charge(
    tabId,
    OVER_CAP_AMOUNT.toString(),
    MERCHANT,
    'x402:over-cap'
  );
  const overCapRejected = findEvent(overCapCharge.events, 'charge_rejected');
  record(
    'X8b',
    'Contract rejects the same over-cap charge with PER_CHARGE_CAP',
    Boolean(overCapRejected) &&
      overCapRejected?.data?.reason === 'PER_CHARGE_CAP' &&
      (await tokenBalance(MERCHANT)) === merchantBeforeOverCap &&
      Number((await getTab(tabId)).next_nonce) === nonceBeforeAttacks,
    `reason=${overCapRejected?.data?.reason || 'none'} merchant=${merchantBeforeOverCap}`,
    overCapCharge.txHash
  );

  // X9 — revoke: client refuses, contract also rejects
  const revokeOutcome: any = await owner.functionCall({
    contractId: VAULT,
    methodName: 'revoke_tab',
    args: { id: tabId },
    gas: GAS,
    attachedDeposit: BigInt(0),
  });
  const revoked = await waitFor(async () => (await getTab(tabId)).status === 'Revoked');
  const revokeTool = await callMcpTool(mcp, 'tab_pay_and_fetch', {
    url: legitApi.url,
    tab_id: tabId,
  });
  record(
    'X9a',
    'Agent client refuses a revoked Tab before spending gas',
    revoked &&
      revokeTool.parsed.status === 'REFUSED' &&
      revokeTool.parsed.reason === 'TAB_NOT_ACTIVE' &&
      !revokeTool.parsed.txHash,
    `status=${revokeTool.parsed.status} reason=${revokeTool.parsed.reason || 'none'}`,
    revokeOutcome.transaction.hash
  );

  const merchantBeforeRevoke = await tokenBalance(MERCHANT);
  const revokeCharge = await agentClient.charge(
    tabId,
    INVOICE_AMOUNT.toString(),
    MERCHANT,
    'x402:revoked'
  );
  const revokeRejected = findEvent(revokeCharge.events, 'charge_rejected');
  record(
    'X9b',
    'Contract rejects a revoked Tab with TAB_NOT_ACTIVE',
    Boolean(revokeRejected) &&
      revokeRejected?.data?.reason === 'TAB_NOT_ACTIVE' &&
      (await tokenBalance(MERCHANT)) === merchantBeforeRevoke &&
      Number((await getTab(tabId)).next_nonce) === nonceBeforeAttacks,
    `reason=${revokeRejected?.data?.reason || 'none'} merchant=${merchantBeforeRevoke}`,
    revokeCharge.txHash
  );

  const passed = results.filter((result) => result.pass).length;
  const total = results.length;

  const evidence = {
    generated_at: new Date().toISOString(),
    network: 'testnet',
    vault: VAULT,
    token: TOKEN,
    owner: OWNER,
    agent: AGENT,
    payee: MERCHANT,
    attacker: ATTACKER,
    tab_id: tabId,
    scheme: 'tabwrit',
    note: 'x402-style HTTP 402 flow with TabWrit invoices; not a full x402 protocol implementation',
    results,
    passed,
    total,
    transactions: {
      success: successTx,
      attacker_rejected: attackCharge.txHash,
      over_cap_rejected: overCapCharge.txHash,
      revoked_rejected: revokeCharge.txHash,
      revoke: revokeOutcome.transaction.hash,
    },
    explorer: {
      success: explorer(successTx),
      attacker_rejected: explorer(attackCharge.txHash),
      over_cap_rejected: explorer(overCapCharge.txHash),
      revoked_rejected: explorer(revokeCharge.txHash),
    },
  };

  const evidencePath = path.resolve('docs/evidence/agent-x402.json');
  const webDataDir = path.resolve('apps/web/src/data');
  const webCopy = path.resolve(webDataDir, 'agent-x402.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  fs.mkdirSync(webDataDir, { recursive: true });
  fs.writeFileSync(webCopy, JSON.stringify(evidence, null, 2) + '\n');

  console.log('\n' + '='.repeat(112));
  console.log(` RESULT: ${passed}/${total} x402 agent API checks passed`);
  console.log(` Evidence: ${evidencePath}`);
  console.log('='.repeat(112));

  if (passed !== total) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('\n[FAIL] x402 agent API test failed:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    mcp?.close();
    for (const api of apis) {
      await api.close().catch(() => undefined);
    }
  });
