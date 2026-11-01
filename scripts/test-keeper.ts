/**
 * Verifies the optional keeper's testnet behavior. Start the keeper first:
 *   pnpm --filter keeper dev
 * Then run:
 *   pnpm test:keeper
 *
 * Expected: health 200, receipts 401/200, charge 501 MAINNET_REQUIRED,
 * quote 200 with a live 1Click quote. No funds move.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.KEEPER_URL || 'http://localhost:4000';
const envPath = path.resolve('services/keeper/.env');
const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const apiKey = (envText.match(/^KEEPER_API_KEY=(.*)$/m) || [])[1]?.trim();

const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function main() {
  console.log('='.repeat(78));
  console.log(' TAB KEEPER — TESTNET GUARD & LIVE QUOTE CHECK');
  console.log(` endpoint: ${BASE}`);
  console.log('='.repeat(78));

  const health = await fetch(`${BASE}/health`);
  const healthJson: any = await health.json();
  record(
    'health',
    health.status === 200 && healthJson.network === 'testnet',
    `${health.status} network=${healthJson.network}`
  );

  const noAuth = await fetch(`${BASE}/receipts`);
  record('receipts without key', noAuth.status === 401, `${noAuth.status}`);

  const auth = await fetch(`${BASE}/receipts`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  record('receipts with key', auth.status === 200, `${auth.status}`);

  const charge = await fetch(`${BASE}/charge`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      tabId: 1,
      merchantAsset:
        'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
      merchantAmount: '1000000',
      merchantRecipient: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    }),
  });
  const chargeJson: any = await charge.json();
  record(
    'charge testnet guard',
    charge.status === 501 && chargeJson.code === 'MAINNET_REQUIRED',
    `${charge.status} ${chargeJson.code || chargeJson.error}`
  );

  const quote = await fetch(`${BASE}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      originAsset:
        'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      destinationAsset:
        'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
      amount: '10000000',
      recipient: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    }),
  });
  const quoteJson: any = await quote.json();
  record(
    'live 1Click quote',
    quote.status === 200 && Boolean(quoteJson.quote?.quote?.amountIn),
    `${quote.status} amountIn=${quoteJson.quote?.quote?.amountIn}`
  );

  const failed = checks.filter((c) => !c.pass);
  console.log('='.repeat(78));
  console.log(
    failed.length === 0
      ? ' KEEPER CHECK PASSED: auth, testnet guard and live quote.'
      : ` KEEPER CHECK FAILED: ${failed.length} check(s). Is the keeper running on ${BASE}?`
  );
  console.log('='.repeat(78));
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  console.error(`Start the keeper with: pnpm --filter keeper dev`);
  process.exit(1);
});
