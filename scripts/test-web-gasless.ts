/**
 * Exercises the browser-facing gasless merchant route end to end:
 *
 *   owner creates a Tab -> browser calls /api/merchant/charge-gasless ->
 *   web server signs a NEP-366 delegate with the merchant's scoped key ->
 *   keeper relayer pays gas -> contract settles the charge.
 *
 * Prerequisites: web on http://localhost:3005 and keeper on :4000.
 * Usage: pnpm test:web-gasless
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair, providers } = nearAPI;

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const VAULT = process.env.TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet';
const TOKEN = process.env.TAB_TOKEN_ID || 'tab-usdc.testnet';
const OWNER = process.env.TESTER_ACCOUNT_ID || 'hardjava737.testnet';
const OWNER_KEY = process.env.TESTER_PRIVATE_KEY;
const MERCHANT = process.env.MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';
const WEB = process.env.WEB_URL || 'http://localhost:3005';

if (!OWNER_KEY) {
  console.error('Missing TESTER_PRIVATE_KEY in .env.');
  process.exit(1);
}

const U = 10_000_000n; // 10 tUSDC (the merchant invoice)
const MIN_STORAGE = BigInt('10000000000000000000000');
const GAS = BigInt('50000000000000');
const provider = new providers.JsonRpcProvider({ url: RPC });
const results: Array<{ id: string; name: string; pass: boolean; detail: string; tx?: string }> = [];

function record(id: string, name: string, pass: boolean, detail: string, tx?: string) {
  results.push({ id, name, pass, detail, tx });
  console.log(
    `[${pass ? 'PASS' : 'FAIL'}] ${id.padEnd(4)} ${name.padEnd(50)} ${detail}${
      tx ? ` tx=${tx.slice(0, 8)}...` : ''
    }`
  );
}

async function view<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res: any = await provider.query({
    request_type: 'call_function',
    account_id: VAULT,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    finality: 'optimistic',
  });
  return JSON.parse(Buffer.from(res.result).toString('utf8')) as T;
}

async function tokenBalance(id: string): Promise<bigint> {
  const res: any = await provider.query({
    request_type: 'call_function',
    account_id: TOKEN,
    method_name: 'ft_balance_of',
    args_base64: Buffer.from(JSON.stringify({ account_id: id })).toString('base64'),
    finality: 'optimistic',
  });
  return BigInt(JSON.parse(Buffer.from(res.result).toString('utf8')));
}

async function nearBalance(id: string): Promise<bigint> {
  const state: any = await provider.query({
    request_type: 'view_account',
    finality: 'final',
    account_id: id,
  });
  return BigInt(state.amount);
}

async function getTab(tabId: number): Promise<any> {
  for (let i = 0; i < 12; i++) {
    const tab = await view<any>('get_tab', { tab_id: tabId });
    if (tab) return tab;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Tab #${tabId} not visible`);
}

async function vaultLedger(): Promise<bigint> {
  return BigInt(await view<string>('get_balance', { owner: OWNER, token: TOKEN }));
}

async function ensureOwnerFunds(owner: nearAPI.Account) {
  let wallet = await tokenBalance(OWNER);
  if (wallet < 15n * U) {
    await owner.functionCall({
      contractId: TOKEN,
      methodName: 'faucet',
      args: {},
      gas: BigInt('30000000000000'),
      attachedDeposit: BigInt(0),
    });
    wallet = await tokenBalance(OWNER);
  }
  const ledger = await vaultLedger();
  if (ledger < 10n * U) {
    await owner.functionCall({
      contractId: TOKEN,
      methodName: 'ft_transfer_call',
      args: {
        receiver_id: VAULT,
        amount: (10n * U - ledger).toString(),
        msg: '',
      },
      gas: GAS,
      attachedDeposit: BigInt(1),
    });
  }
}

async function main() {
  console.log('='.repeat(100));
  console.log(' TABWRIT — WEB GASLESS CHECKOUT (testnet only)');
  console.log(` Owner: ${OWNER}   Merchant: ${MERCHANT}`);
  console.log('='.repeat(100));

  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', OWNER, KeyPair.fromString(OWNER_KEY as never));
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore });
  const owner = await near.account(OWNER);
  await ensureOwnerFunds(owner);

  const create: any = await owner.functionCall({
    contractId: VAULT,
    methodName: 'create_tab',
    args: {
      spender: MERCHANT,
      token: TOKEN,
      per_charge_cap: U.toString(),
      per_period_cap: U.toString(),
      total_cap: (3n * U).toString(),
      period_secs: 3600,
      expires_at_ns: Math.floor((Date.now() + 60 * 60 * 1000) * 1_000_000),
      receiver_policy: { Allowlist: [MERCHANT] },
      label: `Web gasless ${Date.now().toString().slice(-6)}`,
    },
    gas: GAS,
    attachedDeposit: MIN_STORAGE,
  });
  const raw = Buffer.from(create.status.SuccessValue || '', 'base64').toString('utf8');
  const tabId = Number(JSON.parse(raw));
  console.log(`[prep] Tab #${tabId}: https://testnet.nearblocks.io/txns/${create.transaction.hash}`);
  const before = await getTab(tabId);

  const merchantTokenBefore = await tokenBalance(MERCHANT);
  const merchantNearBefore = await nearBalance(MERCHANT);

  const reference = `web-gasless-${tabId}-${Date.now()}`;
  const res = await fetch(`${WEB}/api/merchant/charge-gasless`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tabId, reference }),
  });
  const json: any = await res.json();
  record(
    'G1',
    'Web route returns a gasless executed receipt',
    res.status === 200 && json.status === 'executed' && json.gasless === true,
    `${res.status} status=${json.status} relayer=${json.relayer || '-'}${
      json.reason ? ` reason=${json.reason}` : ''
    }`,
    json.txHash
  );

  let after: any = before;
  let merchantTokenAfter = merchantTokenBefore;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    after = await getTab(tabId);
    merchantTokenAfter = await tokenBalance(MERCHANT);
    if (
      BigInt(after.spent_total) === U &&
      Number(after.charge_count) === 1 &&
      merchantTokenAfter === merchantTokenBefore + U
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  record(
    'G2',
    'Contract recorded exactly one 10 tUSDC charge',
    BigInt(after.spent_total) === U &&
      Number(after.charge_count) === 1 &&
      merchantTokenAfter === merchantTokenBefore + U,
    `spent=${after.spent_total} count=${after.charge_count} merchant ${merchantTokenBefore}->${merchantTokenAfter}`,
    json.txHash
  );

  const merchantNearAfter = await nearBalance(MERCHANT);
  record(
    'G3',
    'Merchant NEAR balance unchanged (relayer paid gas)',
    merchantNearAfter === merchantNearBefore,
    `${merchantNearBefore} -> ${merchantNearAfter}`
  );

  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(100));
  console.log(` RESULT: ${results.length - failed.length}/${results.length} checks passed`);
  console.log('='.repeat(100));

  const report = {
    network: 'testnet',
    vault: VAULT,
    token: TOKEN,
    owner: OWNER,
    merchant: MERCHANT,
    tabId,
    generatedAt: new Date().toISOString(),
    relayTx: json.txHash,
    relayer: json.relayer,
    gasless: json.gasless,
    results,
  };
  const reportJson = JSON.stringify(report, null, 2);
  fs.mkdirSync(path.resolve('docs/evidence'), { recursive: true });
  fs.writeFileSync(path.resolve('docs/evidence/web-gasless.json'), reportJson);
  fs.mkdirSync(path.resolve('apps/web/src/data'), { recursive: true });
  fs.writeFileSync(path.resolve('apps/web/src/data/web-gasless.json'), reportJson);
  console.log('Report: docs/evidence/web-gasless.json');

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
