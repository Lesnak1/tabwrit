/**
 * End-to-end test with the human-provided fresh testnet wallet.
 *
 * The wallet is `tab-tester.testnet` (created with the human's key). The
 * script performs the exact owner flow the web app performs:
 *
 *   faucet -> deposit -> create Tab -> pause/resume -> merchant charge ->
 *   rejection checks -> replay check -> withdraw.
 *
 * All transactions are testnet-only. The private key is read from .env and is
 * never printed. The report contains only public account IDs and tx hashes.
 *
 * Usage: pnpm test:tester
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair, providers } = nearAPI;

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const VAULT = process.env.TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet';
const TOKEN = process.env.TAB_TOKEN_ID || 'tab-usdc.testnet';
const OWNER = process.env.TESTER_ACCOUNT_ID || 'tab-tester.testnet';
const OWNER_KEY = process.env.TESTER_PRIVATE_KEY;
const MERCHANT = process.env.MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';
const MERCHANT_KEY = process.env.TESTNET_MERCHANT_CHARGE_PRIVATE_KEY;

if (!OWNER_KEY) {
  console.error('Missing TESTER_PRIVATE_KEY in .env.');
  process.exit(1);
}
if (!MERCHANT_KEY) {
  console.error('Missing TESTNET_MERCHANT_CHARGE_PRIVATE_KEY in .env.');
  process.exit(1);
}

const U = 1_000_000n; // 1 tUSDC
const MIN_STORAGE = BigInt('10000000000000000000000'); // 0.01 NEAR
const GAS_CALL = BigInt('50000000000000');
const GAS_CHARGE = BigInt('100000000000000');
const EXPLORER = 'https://testnet.nearblocks.io/txns/';
const provider = new providers.JsonRpcProvider({ url: RPC });

type Result = { id: string; name: string; pass: boolean; detail: string; tx?: string };
const results: Result[] = [];

function record(r: Result) {
  results.push(r);
  console.log(
    `[${r.pass ? 'PASS' : 'FAIL'}] ${r.id.padEnd(5)} ${r.name.padEnd(46)} ${r.detail}${
      r.tx ? ` tx=${r.tx.slice(0, 8)}...` : ''
    }`
  );
}

function link(tx?: string) {
  return tx ? `${EXPLORER}${tx}` : undefined;
}

function normalizeReason(reason: unknown): string {
  if (typeof reason !== 'string') return String(reason);
  if (reason.includes('_')) return reason;
  return reason.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
}

async function view<T = any>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res: any = await provider.query({
    request_type: 'call_function',
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    finality: 'optimistic',
  });
  return JSON.parse(Buffer.from(res.result).toString('utf8')) as T;
}

async function accountFor(id: string, key: string) {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', id, KeyPair.fromString(key as never));
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore });
  return near.account(id);
}

async function tokenBalance(id: string): Promise<bigint> {
  return BigInt(await view<string>(TOKEN, 'ft_balance_of', { account_id: id }));
}
async function vaultBalance(owner: string): Promise<bigint> {
  return BigInt(await view<string>(VAULT, 'get_balance', { owner, token: TOKEN }));
}
async function getTab(id: number): Promise<any> {
  for (let i = 0; i < 8; i++) {
    const tab = await view<any>(VAULT, 'get_tab', { tab_id: id });
    if (tab) return tab;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Tab #${id} not visible`);
}

async function waitForStatus(id: number, expected: string, timeoutMs = 6000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    last = await getTab(id);
    if (last.status === expected) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return last;
}

function decodeValue(outcome: any): any {
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
        const ev = JSON.parse(log.slice('EVENT_JSON:'.length));
        if (ev.event === name) return ev;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

async function ownerCall(
  owner: nearAPI.Account,
  method: string,
  args: Record<string, unknown>,
  gas = GAS_CALL,
  deposit = BigInt(0)
) {
  return owner.functionCall({
    contractId: VAULT,
    methodName: method,
    args,
    gas,
    attachedDeposit: deposit,
  });
}

async function merchantCharge(
  merchant: nearAPI.Account,
  tabId: number,
  amount: bigint,
  receiver: string,
  reference: string,
  nonceOverride?: number
): Promise<{ kind: string; reason?: string; tx?: string; event?: any }> {
  const tab = await getTab(tabId);
  const nonce = nonceOverride ?? Number(tab.next_nonce);
  try {
    const outcome: any = await merchant.functionCall({
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
    const value = decodeValue(outcome);
    if (value?.Rejected) {
      return {
        kind: 'rejected',
        reason: normalizeReason(value.Rejected.reason || 'REJECTED'),
        tx: outcome.transaction.hash,
        event: findEvent(outcome, 'charge_rejected'),
      };
    }
    const event = findEvent(outcome, 'charge_executed');
    if (event) return { kind: 'executed', tx: outcome.transaction.hash, event };
    const failed = findEvent(outcome, 'charge_failed');
    if (failed) return { kind: 'failed', reason: failed.data?.reason, tx: outcome.transaction.hash, event: failed };
    return { kind: 'unknown', tx: outcome.transaction.hash };
  } catch (err: any) {
    return {
      kind: 'error',
      reason: String(err?.message || err).slice(0, 220),
      tx: err?.transaction_outcome?.id || err?.transaction?.hash,
    };
  }
}

async function main() {
  console.log('='.repeat(100));
  console.log(' TABWRIT — FRESH TEST WALLET END-TO-END (testnet only)');
  console.log(` Owner:   ${OWNER}`);
  console.log(` Vault:   ${VAULT}`);
  console.log(` Token:   ${TOKEN}`);
  console.log(` Merchant:${MERCHANT}`);
  console.log('='.repeat(100));

  const owner = await accountFor(OWNER, OWNER_KEY as string);
  const merchant = await accountFor(MERCHANT, MERCHANT_KEY as string);

  // 0. Wallet NEAR
  const state = await owner.state();
  record({
    id: 'W0',
    name: 'Fresh wallet has testnet NEAR',
    pass: BigInt(state.amount) > 10n ** 24n, // > 1 NEAR
    detail: `${(BigInt(state.amount) / 10n ** 24n).toString()} NEAR`,
  });

  // 1. Faucet
  let ownerTokens = await tokenBalance(OWNER);
  if (ownerTokens < 100n * U) {
    const outcome = await owner.functionCall({
      contractId: TOKEN,
      methodName: 'faucet',
      args: {},
      gas: BigInt('30000000000000'),
      attachedDeposit: BigInt(0),
    });
    ownerTokens = await tokenBalance(OWNER);
    record({
      id: 'W1',
      name: 'Public faucet registers and mints tUSDC',
      pass: ownerTokens >= 100n * U,
      detail: `${ownerTokens} atomic tUSDC`,
      tx: outcome.transaction.hash,
    });
  } else {
    record({
      id: 'W1',
      name: 'Wallet already holds test tUSDC',
      pass: true,
      detail: `${ownerTokens} atomic`,
    });
  }

  // 2. Deposit 50 tUSDC
  let vault = await vaultBalance(OWNER);
  if (vault < 50n * U) {
    const amount = (50n * U - vault).toString();
    const outcome = await owner.functionCall({
      contractId: TOKEN,
      methodName: 'ft_transfer_call',
      args: { receiver_id: VAULT, amount, msg: '' },
      gas: GAS_CALL,
      attachedDeposit: BigInt(1),
    });
    vault = await vaultBalance(OWNER);
    record({
      id: 'W2',
      name: 'NEP-141 deposit credits the owner ledger',
      pass: vault >= 50n * U,
      detail: `${vault} atomic ledger`,
      tx: outcome.transaction.hash,
    });
  } else {
    record({
      id: 'W2',
      name: 'Vault ledger already funded',
      pass: true,
      detail: `${vault} atomic`,
    });
  }

  // 3. Create a subscription Tab
  const createOutcome: any = await ownerCall(
    owner,
    'create_tab',
    {
      spender: MERCHANT,
      token: TOKEN,
      per_charge_cap: (10n * U).toString(),
      per_period_cap: (10n * U).toString(),
      total_cap: (120n * U).toString(),
      period_secs: 30 * 86400,
      expires_at_ns: Math.floor((Date.now() + 365 * 86400 * 1000) * 1_000_000),
      receiver_policy: 'Any',
      label: 'Tester subscription',
    },
    GAS_CALL,
    MIN_STORAGE
  );
  const tabId = Number(decodeValue(createOutcome));
  const tab0 = await waitForStatus(tabId, 'Active');
  record({
    id: 'W3',
    name: 'create_tab stores the owner rule on-chain',
    pass:
      Number(tabId) > 0 &&
      tab0.owner === OWNER &&
      tab0.spender === MERCHANT &&
      tab0.token === TOKEN &&
      tab0.status === 'Active' &&
      Number(tab0.next_nonce) === 0,
    detail: `Tab #${tabId} owner=${tab0.owner} spender=${tab0.spender}`,
    tx: createOutcome.transaction.hash,
  });

  // 4. Pause / resume
  const pause = await ownerCall(owner, 'pause_tab', { id: tabId });
  const paused = await waitForStatus(tabId, 'Paused');
  record({
    id: 'W4',
    name: 'Owner pauses the Tab',
    pass: paused.status === 'Paused',
    detail: paused.status,
    tx: pause.transaction.hash,
  });
  const resume = await ownerCall(owner, 'resume_tab', { id: tabId });
  const resumed = await waitForStatus(tabId, 'Active');
  record({
    id: 'W5',
    name: 'Owner resumes the Tab',
    pass: resumed.status === 'Active',
    detail: resumed.status,
    tx: resume.transaction.hash,
  });

  // 5. Paused charge rejected
  await ownerCall(owner, 'pause_tab', { id: tabId });
  const pausedCharge = await merchantCharge(
    merchant,
    tabId,
    1n * U,
    MERCHANT,
    'tester-paused'
  );
  record({
    id: 'W6',
    name: 'Paused Tab rejects merchant charge',
    pass: pausedCharge.kind === 'rejected' && pausedCharge.reason === 'TAB_NOT_ACTIVE',
    detail: pausedCharge.kind === 'rejected' ? pausedCharge.reason! : pausedCharge.kind,
    tx: pausedCharge.tx,
  });
  await ownerCall(owner, 'resume_tab', { id: tabId });

  // 6. Over-cap charge rejected
  const overCap = await merchantCharge(
    merchant,
    tabId,
    11n * U,
    MERCHANT,
    'tester-over-cap'
  );
  record({
    id: 'W7',
    name: 'Over per-charge-cap charge rejected',
    pass: overCap.kind === 'rejected' && overCap.reason === 'PER_CHARGE_CAP',
    detail: overCap.kind === 'rejected' ? overCap.reason! : overCap.kind,
    tx: overCap.tx,
  });

  // 7. Legitimate merchant charge
  const ownerBefore = await tokenBalance(OWNER);
  const merchantBefore = await tokenBalance(MERCHANT);
  const vaultBefore = await vaultBalance(OWNER);
  const legit = await merchantCharge(
    merchant,
    tabId,
    10n * U,
    MERCHANT,
    'tester-legit'
  );
  const tabAfter = await getTab(tabId);
  await new Promise((r) => setTimeout(r, 2500));
  const ownerAfter = await tokenBalance(OWNER);
  const merchantAfter = await tokenBalance(MERCHANT);
  const vaultAfter = await vaultBalance(OWNER);
  record({
    id: 'W8',
    name: 'Legitimate merchant charge settles',
    pass:
      legit.kind === 'executed' &&
      BigInt(tabAfter.spent_total) === 10n * U &&
      Number(tabAfter.next_nonce) === 1 &&
      vaultAfter === vaultBefore - 10n * U &&
      merchantAfter === merchantBefore + 10n * U,
    detail: `spent=${tabAfter.spent_total} nonce=${tabAfter.next_nonce} vault ${vaultBefore}->${vaultAfter} merchant ${merchantBefore}->${merchantAfter}`,
    tx: legit.tx,
  });

  // 8. Replay rejected
  const replay = await merchantCharge(
    merchant,
    tabId,
    10n * U,
    MERCHANT,
    'tester-replay',
    0
  );
  record({
    id: 'W9',
    name: 'Consumed nonce cannot be replayed',
    pass: replay.kind === 'error' && String(replay.reason).includes('ERR_NONCE_MISMATCH'),
    detail: replay.kind === 'error' ? String(replay.reason).slice(0, 80) : replay.kind,
    tx: replay.tx,
  });

  // 9. Second Tab + revoke
  const second: any = await ownerCall(
    owner,
    'create_tab',
    {
      spender: MERCHANT,
      token: TOKEN,
      per_charge_cap: (1n * U).toString(),
      per_period_cap: (1n * U).toString(),
      total_cap: (1n * U).toString(),
      period_secs: 3600,
      expires_at_ns: Math.floor((Date.now() + 3600 * 1000) * 1_000_000),
      receiver_policy: 'Any',
      label: 'Tester revoke',
    },
    GAS_CALL,
    MIN_STORAGE
  );
  const secondId = Number(decodeValue(second));
  await ownerCall(owner, 'revoke_tab', { id: secondId });
  const revoked = await waitForStatus(secondId, 'Revoked');
  const revokedCharge = await merchantCharge(
    merchant,
    secondId,
    1n * U,
    MERCHANT,
    'tester-revoked'
  );
  record({
    id: 'W10',
    name: 'Revoked Tab is terminal and rejects charge',
    pass:
      revoked.status === 'Revoked' &&
      revokedCharge.kind === 'rejected' &&
      revokedCharge.reason === 'TAB_NOT_ACTIVE',
    detail: `${revoked.status} / ${
      revokedCharge.kind === 'rejected' ? revokedCharge.reason : revokedCharge.kind
    }`,
    tx: revokedCharge.tx,
  });

  // 10. Withdraw
  const vaultBeforeWithdraw = await vaultBalance(OWNER);
  const ownerBeforeWithdraw = await tokenBalance(OWNER);
  const withdraw = await ownerCall(
    owner,
    'withdraw',
    {
      token: TOKEN,
      amount: (10n * U).toString(),
    },
    GAS_CHARGE,
    BigInt(0)
  );
  await new Promise((r) => setTimeout(r, 2500));
  const vaultAfterWithdraw = await vaultBalance(OWNER);
  const ownerAfterWithdraw = await tokenBalance(OWNER);
  record({
    id: 'W11',
    name: 'Owner withdraws unspent funds',
    pass:
      vaultAfterWithdraw === vaultBeforeWithdraw - 10n * U &&
      ownerAfterWithdraw === ownerBeforeWithdraw + 10n * U,
    detail: `vault ${vaultBeforeWithdraw}->${vaultAfterWithdraw} wallet ${ownerBeforeWithdraw}->${ownerAfterWithdraw}`,
    tx: withdraw.transaction.hash,
  });

  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(100));
  console.log(` RESULT: ${results.length - failed.length}/${results.length} checks passed.`);
  console.log('='.repeat(100));

  const outDir = path.resolve('docs/evidence');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'tester-wallet-e2e.json'),
    JSON.stringify(
      {
        network: 'testnet',
        owner: OWNER,
        vault: VAULT,
        token: TOKEN,
        merchant: MERCHANT,
        generatedAt: new Date().toISOString(),
        results,
      },
      null,
      2
    )
  );
  console.log('Report: docs/evidence/tester-wallet-e2e.json');

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
