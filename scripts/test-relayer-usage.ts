/**
 * Verifies the keeper's per-sender gas meter.
 *
 * The meter is the off-chain foundation for prepaid relayer credits: the
 * contract cannot take a fee, so the keeper records the actual NEAR gas of
 * each successful NEP-366 relay. Run `pnpm test:meta` first to generate
 * usage, then:
 *
 *   pnpm test:relayer-usage
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.KEEPER_URL || 'http://localhost:4000';
const API_KEY = process.env.RELAYER_API_KEY;
const MERCHANT = process.env.MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';
const AGENT = process.env.TESTNET_AGENT_ACCOUNT_ID || 'tab-agent.testnet';

if (!API_KEY) {
  console.error('Missing RELAYER_API_KEY in .env.');
  process.exit(1);
}

const results: Array<{ id: string; name: string; pass: boolean; detail: string }> = [];

function record(id: string, name: string, pass: boolean, detail: string) {
  results.push({ id, name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id.padEnd(3)} ${name.padEnd(48)} ${detail}`);
}

async function main() {
  console.log('='.repeat(100));
  console.log(' TABWRIT — RELAYER GAS METER (read-only, testnet)');
  console.log(` keeper: ${BASE}`);
  console.log('='.repeat(100));

  const unauth = await fetch(`${BASE}/relay/usage`);
  record('U1', 'Usage endpoint rejects missing API key', unauth.status === 401, `${unauth.status}`);

  const auth = await fetch(`${BASE}/relay/usage`, {
    headers: { authorization: `Bearer ${API_KEY}` },
  });
  const data: any = await auth.json();
  record(
    'U2',
    'Usage endpoint accepts the relayer key',
    auth.status === 200 && Boolean(data?.totals),
    `${auth.status} totals=${JSON.stringify(data?.totals)}`
  );

  const senders: any[] = Array.isArray(data?.senders) ? data.senders : [];
  const merchant = senders.find((s) => s.senderId === MERCHANT);
  const agent = senders.find((s) => s.senderId === AGENT);

  record(
    'U3',
    'Merchant relays are metered with non-zero gas',
    Boolean(merchant) &&
      Number(merchant.relays) >= 1 &&
      BigInt(merchant.tokensBurntYocto) > 0n,
    merchant
      ? `relays=${merchant.relays} gas=${merchant.tokensBurntYocto}`
      : `no record for ${MERCHANT}`
  );
  record(
    'U4',
    'Agent relays are metered with non-zero gas',
    Boolean(agent) &&
      Number(agent.relays) >= 1 &&
      BigInt(agent.tokensBurntYocto) > 0n,
    agent
      ? `relays=${agent.relays} gas=${agent.tokensBurntYocto}`
      : `no record for ${AGENT}`
  );

  const totals = data?.totals || {};
  record(
    'U5',
    'Total metered gas is positive',
    Number(totals.relays) >= 2 && BigInt(totals.tokensBurntYocto || '0') > 0n,
    `relays=${totals.relays} gas=${totals.tokensBurntYocto} senders=${totals.senders}`
  );

  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(100));
  console.log(` RESULT: ${results.length - failed.length}/${results.length} checks passed`);
  console.log('='.repeat(100));

  if (failed.length > 0) {
    console.error('Run `pnpm test:meta` first so the meter has real relays.');
    process.exit(1);
  }

  const report = {
    network: 'testnet',
    generatedAt: new Date().toISOString(),
    keeper: BASE,
    merchant: MERCHANT,
    agent: AGENT,
    totals,
    senders,
    results,
  };
  const reportJson = JSON.stringify(report, null, 2);
  fs.mkdirSync(path.resolve('docs/evidence'), { recursive: true });
  fs.writeFileSync(path.resolve('docs/evidence/relayer-usage.json'), reportJson);
  fs.mkdirSync(path.resolve('apps/web/src/data'), { recursive: true });
  fs.writeFileSync(path.resolve('apps/web/src/data/relayer-usage.json'), reportJson);
  console.log('Report: docs/evidence/relayer-usage.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
