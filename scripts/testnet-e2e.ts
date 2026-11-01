/**
 * Real NEAR Testnet end-to-end + Attack Lab runner.
 *
 * Every scenario below is executed as a real transaction on
 * tab-vault.testnet using the real tab-usdc.testnet NEP-141 token.
 * The script fails if any expected outcome does not match the chain.
 *
 * Prerequisites (see README):
 *   - testnet accounts created (scripts/create-testnet-accounts.ts)
 *   - token + vault deployed (scripts/deploy-testnet.ts)
 *   - merchant scoped key added (scripts/setup-merchant-key.ts)
 *
 * Usage: pnpm testnet:e2e
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair, providers } = nearAPI;

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const NETWORK = 'testnet';
const VAULT = process.env.TESTNET_VAULT_ACCOUNT_ID || 'tab-vault.testnet';
const TOKEN = process.env.TESTNET_TOKEN_ACCOUNT_ID || 'tab-usdc.testnet';
const DEMO = process.env.TESTNET_DEMO_ACCOUNT_ID || 'tab-demo.testnet';
const MERCHANT = process.env.TESTNET_MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';

const DEMO_KEY = process.env.TESTNET_DEMO_PRIVATE_KEY;
const MERCHANT_CHARGE_KEY = process.env.TESTNET_MERCHANT_CHARGE_PRIVATE_KEY;

if (!DEMO_KEY || !MERCHANT_CHARGE_KEY) {
  console.error(
    'Missing TESTNET_DEMO_PRIVATE_KEY or TESTNET_MERCHANT_CHARGE_PRIVATE_KEY in .env. Run the setup scripts first.'
  );
  process.exit(1);
}

const provider = new providers.JsonRpcProvider({ url: RPC });
const U = (n: number) => BigInt(n) * 1_000_000n; // tUSDC has 6 decimals
const MIN_STORAGE = BigInt('10000000000000000000000'); // 0.01 NEAR
const GAS_CHARGE = BigInt('100000000000000');
const GAS_CALL = BigInt('50000000000000');

type Result = {
  id: string;
  scenario: string;
  expected: string;
  actual: string;
  tx?: string;
  pass: boolean;
};

const results: Result[] = [];

function explorer(tx?: string) {
  return tx ? `https://testnet.nearblocks.io/txns/${tx}` : '';
}

function record(r: Result) {
  results.push(r);
  const icon = r.pass ? 'PASS' : 'FAIL';
  console.log(
    `[${icon}] ${r.id.padEnd(3)} ${r.scenario.padEnd(44)} expected=${r.expected.padEnd(
      24
    )} actual=${r.actual}${r.tx ? ` tx=${r.tx.slice(0, 8)}...` : ''}`
  );
}

function normalizeReason(reason: unknown): string {
  if (typeof reason !== 'string') return String(reason);
  if (reason.includes('_')) return reason;
  return reason.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
}

function decodeSuccessValue(outcome: nearAPI.providers.FinalExecutionOutcome): any {
  const status = outcome.status as any;
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

function findEvent(outcome: nearAPI.providers.FinalExecutionOutcome, eventName: string): any {
  for (const receipt of outcome.receipts_outcome || []) {
    for (const log of receipt.outcome.logs || []) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      try {
        const ev = JSON.parse(log.slice('EVENT_JSON:'.length));
        if (ev.event === eventName) return ev;
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
    err?.transaction_outcome?.transaction?.hash ||
    err?.transactionHash
  );
}

async function view<T = any>(contract: string, method: string, args: Record<string, any> = {}): Promise<T> {
  // `optimistic` is intentional: the script reads its own just-submitted
  // transactions, which may not be final on the RPC node yet.
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res: any = await provider.query({
        request_type: 'call_function',
        account_id: contract,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        finality: 'optimistic',
      });
      return JSON.parse(Buffer.from(res.result).toString('utf8')) as T;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastError;
}

async function accountFor(accountId: string, privateKey: string) {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(NETWORK, accountId, KeyPair.fromString(privateKey as never));
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore });
  const account = await near.account(accountId);
  return account;
}

async function tokenBalance(accountId: string): Promise<bigint> {
  const raw = await view<string>(TOKEN, 'ft_balance_of', { account_id: accountId });
  return BigInt(raw);
}

async function vaultBalance(owner: string): Promise<bigint> {
  const raw = await view<string>(VAULT, 'get_balance', { owner, token: TOKEN });
  return BigInt(raw);
}

async function getTab(tabId: number): Promise<any> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const tab = await view<any>(VAULT, 'get_tab', { tab_id: tabId });
    if (tab) return tab;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Tab #${tabId} not visible after 2s`);
}

async function createTab(
  owner: nearAPI.Account,
  opts: {
    label: string;
    perCharge: bigint;
    perPeriod: bigint;
    total: bigint;
    periodSecs: number;
    expiresInSecs: number;
    policy: 'Any' | { Allowlist: string[] };
  }
): Promise<number> {
  const nowMs = Date.now();
  const outcome = await owner.functionCall({
    contractId: VAULT,
    methodName: 'create_tab',
    args: {
      spender: MERCHANT,
      token: TOKEN,
      per_charge_cap: opts.perCharge.toString(),
      per_period_cap: opts.perPeriod.toString(),
      total_cap: opts.total.toString(),
      period_secs: opts.periodSecs,
      expires_at_ns: Math.floor((nowMs + opts.expiresInSecs * 1000) * 1_000_000),
      receiver_policy: opts.policy,
      label: opts.label,
    },
    gas: GAS_CALL,
    attachedDeposit: MIN_STORAGE,
  });
  const value = decodeSuccessValue(outcome);
  if (typeof value !== 'number') {
    throw new Error(`create_tab returned unexpected value: ${JSON.stringify(value)}`);
  }
  return value;
}

type ChargeOutcome =
  | { kind: 'executed'; tx: string; event: any }
  | { kind: 'rejected'; reason: string; tx: string; event?: any }
  | { kind: 'failed'; reason: string; tx: string; event?: any }
  | { kind: 'error'; reason: string; tx?: string };

async function charge(
  spender: nearAPI.Account,
  tabId: number,
  amount: bigint,
  receiver: string,
  reference: string,
  nonceOverride?: number
): Promise<ChargeOutcome> {
  const tab = await getTab(tabId);
  const nonce = nonceOverride ?? Number(tab.next_nonce);

  try {
    const outcome = await spender.functionCall({
      contractId: VAULT,
      methodName: 'charge',
      args: {
        tab_id: tabId,
        amount: amount.toString(),
        receiver_id: receiver,
        reference,
        nonce,
      },
      gas: GAS_CHARGE,
      attachedDeposit: BigInt(0),
    });

    const value = decodeSuccessValue(outcome);
    if (value && value.Rejected) {
      return {
        kind: 'rejected',
        reason: normalizeReason(value.Rejected.reason),
        tx: outcome.transaction.hash,
        event: findEvent(outcome, 'charge_rejected'),
      };
    }

    const executed = findEvent(outcome, 'charge_executed');
    if (executed) return { kind: 'executed', tx: outcome.transaction.hash, event: executed };

    const failed = findEvent(outcome, 'charge_failed');
    if (failed) return { kind: 'failed', reason: failed.data.reason, tx: outcome.transaction.hash, event: failed };

    return {
      kind: 'error',
      reason: `unknown outcome: ${JSON.stringify(value)}`,
      tx: outcome.transaction.hash,
    };
  } catch (err: any) {
    return {
      kind: 'error',
      reason: String(err.message || err).slice(0, 220),
      tx: txFromError(err),
    };
  }
}

async function deposit(owner: nearAPI.Account, amount: bigint): Promise<string> {
  const outcome = await owner.functionCall({
    contractId: TOKEN,
    methodName: 'ft_transfer_call',
    args: {
      receiver_id: VAULT,
      amount: amount.toString(),
      msg: '',
    },
    gas: GAS_CALL,
    attachedDeposit: BigInt(1),
  });
  return outcome.transaction.hash;
}

async function withdraw(owner: nearAPI.Account, amount: bigint): Promise<string> {
  const outcome = await owner.functionCall({
    contractId: VAULT,
    methodName: 'withdraw',
    args: { token: TOKEN, amount: amount.toString() },
    gas: GAS_CHARGE,
    attachedDeposit: BigInt(0),
  });
  return outcome.transaction.hash;
}

function expectRejected(
  id: string,
  scenario: string,
  result: ChargeOutcome,
  expected: string
): void {
  const actual = result.kind === 'rejected' ? result.reason : result.kind === 'error' ? 'ERROR' : result.kind;
  record({
    id,
    scenario,
    expected,
    actual,
    tx: result.tx,
    pass: result.kind === 'rejected' && result.reason === expected,
  });
}

function expectError(id: string, scenario: string, result: ChargeOutcome, expectedSubstring: string): void {
  const actual = result.kind === 'error' ? result.reason : result.kind;
  record({
    id,
    scenario,
    expected: expectedSubstring,
    actual: actual.includes(expectedSubstring) ? expectedSubstring : actual,
    tx: result.tx,
    pass: result.kind === 'error' && actual.includes(expectedSubstring),
  });
}

function expectExecuted(id: string, scenario: string, result: ChargeOutcome): void {
  record({
    id,
    scenario,
    expected: 'executed',
    actual: result.kind,
    tx: result.tx,
    pass: result.kind === 'executed',
  });
}

async function main() {
  console.log('='.repeat(100));
  console.log(' TABWRIT - REAL NEAR TESTNET END-TO-END & ATTACK LAB');
  console.log(` Vault: ${VAULT}`);
  console.log(` Token: ${TOKEN} (${TOKEN === 'tab-usdc.testnet' ? 'Tab Test USDC' : 'NEP-141'})`);
  console.log('='.repeat(100));

  const demo = await accountFor(DEMO, DEMO_KEY as string);
  const merchant = await accountFor(MERCHANT, MERCHANT_CHARGE_KEY as string);

  // Reset state from a previous run: withdraw everything the demo owns in
  // the vault. Tabs are append-only; this script creates new ones.
  const existing = await vaultBalance(DEMO);
  if (existing > 0n) {
    const tx = await withdraw(demo, existing);
    console.log(`[prep] withdrew ${existing} atomic units from a previous run: ${explorer(tx)}`);
  }

  const demoTokenBefore = await tokenBalance(DEMO);
  console.log(`[prep] demo token balance: ${demoTokenBefore}`);

  if (demoTokenBefore < U(100)) {
    console.log('[prep] demo balance below 100 tUSDC; calling the public faucet...');
    await demo.functionCall({
      contractId: TOKEN,
      methodName: 'faucet',
      args: {},
      gas: GAS_CALL,
      attachedDeposit: BigInt(0),
    });
  }

  const available = await tokenBalance(DEMO);
  const depositAmount = available > U(100) ? U(100) : available;
  const depositTx = await deposit(demo, depositAmount);
  const ledger = await vaultBalance(DEMO);
  record({
    id: 'D0',
    scenario: 'Deposit tUSDC into the vault via ft_transfer_call',
    expected: `${depositAmount} ledger`,
    actual: `${ledger} ledger`,
    tx: depositTx,
    pass: ledger === depositAmount,
  });

  const merchantBefore = await tokenBalance(MERCHANT);
  const statsBefore = await view<any>(VAULT, 'get_stats', { token: TOKEN });

  // --- Tab A: caps + allowlist + pause ---
  const tabA = await createTab(demo, {
    label: 'Tab A - capped subscription',
    perCharge: U(10),
    perPeriod: U(25),
    total: U(50),
    periodSecs: 3600,
    expiresInSecs: 3600,
    policy: { Allowlist: [MERCHANT] },
  });
  console.log(`[tab] A = #${tabA}`);

  expectExecuted(
    'S1',
    'Legitimate charge inside every cap',
    await charge(merchant, tabA, U(10), MERCHANT, 'A-1')
  );

  expectRejected(
    'S2',
    'Prompt-injection charge above per-charge cap',
    await charge(merchant, tabA, U(15), MERCHANT, 'A-2'),
    'PER_CHARGE_CAP'
  );

  expectExecuted(
    'S3',
    'Second legitimate charge inside period budget',
    await charge(merchant, tabA, U(10), MERCHANT, 'A-3')
  );

  expectRejected(
    'S3b',
    'Period budget exhaustion',
    await charge(merchant, tabA, U(10), MERCHANT, 'A-4'),
    'PERIOD_CAP'
  );

  expectRejected(
    'S4',
    'Phishing charge to an unapproved receiver',
    await charge(merchant, tabA, U(1), 'attacker.testnet', 'A-5'),
    'RECEIVER_NOT_ALLOWED'
  );

  await demo.functionCall({
    contractId: VAULT,
    methodName: 'pause_tab',
    args: { id: tabA },
    gas: GAS_CALL,
    attachedDeposit: BigInt(0),
  });
  expectRejected(
    'S5',
    'Charge while the owner has paused the Tab',
    await charge(merchant, tabA, U(5), MERCHANT, 'A-6'),
    'TAB_NOT_ACTIVE'
  );
  await demo.functionCall({
    contractId: VAULT,
    methodName: 'resume_tab',
    args: { id: tabA },
    gas: GAS_CALL,
    attachedDeposit: BigInt(0),
  });

  // --- S7: unauthorized caller (the owner is not the spender) ---
  const unauthorized = await charge(demo, tabA, U(5), MERCHANT, 'A-7');
  expectError('S7', 'Unauthorized account calls charge', unauthorized, 'ERR_CALLER_NOT_SPENDER');

  // --- Tab B: rollover with a 3-second period ---
  const tabB = await createTab(demo, {
    label: 'Tab B - rollover',
    perCharge: U(10),
    perPeriod: U(10),
    total: U(30),
    periodSecs: 15,
    expiresInSecs: 3600,
    policy: 'Any',
  });
  console.log(`[tab] B = #${tabB}`);
  expectExecuted(
    'S9a',
    'Rollover Tab: first charge in period 0',
    await charge(merchant, tabB, U(10), MERCHANT, 'B-1')
  );
  expectRejected(
    'S9b',
    'Rollover Tab: period 0 budget exhausted',
    await charge(merchant, tabB, U(10), MERCHANT, 'B-2'),
    'PERIOD_CAP'
  );
  console.log('[wait] 16s for the 15s period to roll over...');
  await new Promise((r) => setTimeout(r, 16500));
  expectExecuted(
    'S9c',
    'Rollover Tab: charge succeeds in the new period',
    await charge(merchant, tabB, U(10), MERCHANT, 'B-3')
  );

  // --- S8: insufficient vault balance ---
  const tabC = await createTab(demo, {
    label: 'Tab C - insufficient balance',
    perCharge: U(100),
    perPeriod: U(100),
    total: U(100),
    periodSecs: 3600,
    expiresInSecs: 3600,
    policy: 'Any',
  });
  console.log(`[tab] C = #${tabC}`);
  expectRejected(
    'S8',
    'Charge larger than the vault ledger balance',
    await charge(merchant, tabC, U(100), MERCHANT, 'C-1'),
    'INSUFFICIENT_BALANCE'
  );

  // --- S10: real ft_transfer failure -> callback rollback ---
  const tabD = await createTab(demo, {
    label: 'Tab D - callback rollback',
    perCharge: U(10),
    perPeriod: U(10),
    total: U(10),
    periodSecs: 3600,
    expiresInSecs: 3600,
    policy: 'Any',
  });
  console.log(`[tab] D = #${tabD}`);
  const ledgerBeforeD = await vaultBalance(DEMO);
  const failedD = await charge(merchant, tabD, U(10), 'unregistered-account.testnet', 'D-1');
  record({
    id: 'S10a',
    scenario: 'NEP-141 transfer to an unregistered account fails',
    expected: 'failed',
    actual: failedD.kind === 'failed' ? `failed: ${failedD.reason}` : failedD.kind,
    tx: failedD.tx,
    pass: failedD.kind === 'failed',
  });
  const tabDAfter = await getTab(tabD);
  const ledgerAfterD = await vaultBalance(DEMO);
  record({
    id: 'S10b',
    scenario: 'Callback restores ledger and cap counters',
    expected: `ledger ${ledgerBeforeD}, spent 0, nonce 0`,
    actual: `ledger ${ledgerAfterD}, spent ${tabDAfter.spent_total}, nonce ${tabDAfter.next_nonce}`,
    pass:
      ledgerAfterD === ledgerBeforeD &&
      BigInt(tabDAfter.spent_total) === 0n &&
      Number(tabDAfter.next_nonce) === 0,
  });

  // --- S11: replay a consumed nonce on a fresh tab ---
  const tabE = await createTab(demo, {
    label: 'Tab E - replay guard',
    perCharge: U(10),
    perPeriod: U(10),
    total: U(10),
    periodSecs: 3600,
    expiresInSecs: 3600,
    policy: 'Any',
  });
  console.log(`[tab] E = #${tabE}`);
  expectExecuted(
    'S11a',
    'Replay Tab: first charge consumes nonce 0',
    await charge(merchant, tabE, U(10), MERCHANT, 'E-1')
  );
  const replay = await charge(merchant, tabE, U(10), MERCHANT, 'E-1-replay', 0);
  expectError('S11b', 'Replay the already-consumed nonce', replay, 'ERR_NONCE_MISMATCH');

  // --- S12: expiry ---
  const tabF = await createTab(demo, {
    label: 'Tab F - short expiry',
    perCharge: U(10),
    perPeriod: U(10),
    total: U(10),
    periodSecs: 3600,
    expiresInSecs: 3,
    policy: 'Any',
  });
  console.log(`[tab] F = #${tabF}`);
  console.log('[wait] 4s for the Tab to expire...');
  await new Promise((r) => setTimeout(r, 4200));
  expectRejected(
    'S12',
    'Charge after the on-chain expiry timestamp',
    await charge(merchant, tabF, U(10), MERCHANT, 'F-1'),
    'TAB_EXPIRED'
  );

  // --- S13: revoke ---
  const tabG = await createTab(demo, {
    label: 'Tab G - revocation',
    perCharge: U(10),
    perPeriod: U(10),
    total: U(10),
    periodSecs: 3600,
    expiresInSecs: 3600,
    policy: 'Any',
  });
  console.log(`[tab] G = #${tabG}`);
  expectExecuted(
    'S13a',
    'Charge before revocation',
    await charge(merchant, tabG, U(10), MERCHANT, 'G-1')
  );
  await demo.functionCall({
    contractId: VAULT,
    methodName: 'revoke_tab',
    args: { id: tabG },
    gas: GAS_CALL,
    attachedDeposit: BigInt(0),
  });
  expectRejected(
    'S13b',
    'Charge after permanent revocation',
    await charge(merchant, tabG, U(10), MERCHANT, 'G-2'),
    'TAB_NOT_ACTIVE'
  );

  // --- S14: withdraw ---
  const demoBeforeWithdraw = await tokenBalance(DEMO);
  const ledgerBeforeWithdraw = await vaultBalance(DEMO);
  const withdrawAmount = U(10);
  const withdrawTx = await withdraw(demo, withdrawAmount);
  const demoAfterWithdraw = await tokenBalance(DEMO);
  const ledgerAfterWithdraw = await vaultBalance(DEMO);
  record({
    id: 'S14',
    scenario: 'Owner withdraws from the vault',
    expected: `+${withdrawAmount} wallet, -${withdrawAmount} ledger`,
    actual: `+${demoAfterWithdraw - demoBeforeWithdraw} wallet, -${
      ledgerBeforeWithdraw - ledgerAfterWithdraw
    } ledger`,
    tx: withdrawTx,
    pass:
      demoAfterWithdraw - demoBeforeWithdraw === withdrawAmount &&
      ledgerBeforeWithdraw - ledgerAfterWithdraw === withdrawAmount,
  });

  // --- Final conservation / stats check ---
  const merchantAfter = await tokenBalance(MERCHANT);
  const finalLedger = await vaultBalance(DEMO);
  const stats = await view<any>(VAULT, 'get_stats', { token: TOKEN });
  const expectedCharged = 60n * 10n ** 6n; // A:20, B:20, E:10, G:10 tUSDC
  record({
    id: 'F1',
    scenario: 'Merchant received exactly the executed charges',
    expected: `${expectedCharged} delta`,
    actual: `${merchantAfter - merchantBefore} delta`,
    pass: merchantAfter - merchantBefore === expectedCharged,
  });
  const chargesDelta = Number(stats.total_charges) - Number(statsBefore.total_charges);
  const volumeDelta = BigInt(stats.total_volume) - BigInt(statsBefore.total_volume);
  record({
    id: 'F2',
    scenario: 'Contract stats count only confirmed settlements (delta)',
    expected: `charges=6, volume=${expectedCharged}`,
    actual: `charges=${chargesDelta}, volume=${volumeDelta}`,
    pass: chargesDelta === 6 && volumeDelta === expectedCharged,
  });
  record({
    id: 'F3',
    scenario: 'Vault ledger conservation',
    expected: `${depositAmount - expectedCharged - withdrawAmount}`,
    actual: `${finalLedger}`,
    pass: finalLedger === depositAmount - expectedCharged - withdrawAmount,
  });

  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(100));
  console.log(` RESULT: ${results.length - failed.length}/${results.length} checks passed`);
  console.log('='.repeat(100));

  const outDir = path.resolve(process.cwd(), 'docs/evidence');
  fs.mkdirSync(outDir, { recursive: true });
  const report = {
    network: NETWORK,
    vault: VAULT,
    token: TOKEN,
    demo: DEMO,
    merchant: MERCHANT,
    generatedAt: new Date().toISOString(),
    depositTx,
    results,
  };
  const reportJson = JSON.stringify(report, null, 2);
  fs.writeFileSync(path.join(outDir, 'testnet-e2e.json'), reportJson);
  const webDataDir = path.resolve(process.cwd(), 'apps/web/src/data');
  fs.mkdirSync(webDataDir, { recursive: true });
  fs.writeFileSync(path.join(webDataDir, 'testnet-e2e.json'), reportJson);
  console.log(`Report: docs/evidence/testnet-e2e.json`);
  console.log(`Web copy: apps/web/src/data/testnet-e2e.json`);

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
