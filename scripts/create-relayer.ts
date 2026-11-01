/**
 * Creates the testnet relayer account used by the NEP-366 meta-transaction
 * path. The relayer only pays gas; it never receives an owner or merchant
 * key and it only relays delegates signed by a Function-Call key scoped to
 * `<vault>::charge`.
 *
 * Secrets are written to the gitignored `.env` files and are never printed.
 *
 * Usage: pnpm tsx scripts/create-relayer.ts
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { KeyPair } from 'near-api-js';

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const HELPER = 'https://helper.testnet.near.org/account';
const ROOT_ENV = path.resolve(process.cwd(), '.env');
const KEEPER_ENV = path.resolve(process.cwd(), 'services/keeper/.env');
const WEB_ENV = path.resolve(process.cwd(), 'apps/web/.env.local');
const ACCOUNT_ID = process.env.RELAYER_ACCOUNT_ID || 'tab-relayer.testnet';

function upsertEnv(text: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, `${key}=${value}`);
  return `${text}${text.endsWith('\n') || text.length === 0 ? '' : '\n'}${key}=${value}\n`;
}

function readEnv(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

async function accountExists(accountId: string): Promise<boolean> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'query',
      params: {
        request_type: 'view_account',
        finality: 'final',
        account_id: accountId,
      },
    }),
  });
  const json: any = await res.json();
  return !json.error;
}

async function main() {
  let root = readEnv(ROOT_ENV);
  let keeper = readEnv(KEEPER_ENV);
  let web = readEnv(WEB_ENV);

  const existingKey = (root.match(/^RELAYER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
  const keyPair = existingKey
    ? KeyPair.fromString(existingKey as never)
    : KeyPair.fromRandom('ed25519');
  const publicKey = keyPair.getPublicKey().toString();

  if (await accountExists(ACCOUNT_ID)) {
    console.log(`[skip] relayer account exists: ${ACCOUNT_ID}`);
  } else {
    const res = await fetch(HELPER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newAccountId: ACCOUNT_ID,
        newAccountPublicKey: publicKey,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`helper ${res.status}: ${text.slice(0, 500)}`);
    }
    let final = 'unknown';
    try {
      final = JSON.parse(text).final_execution_status || final;
    } catch {
      // helper returned non-JSON; the account check below is authoritative
    }
    console.log(`[create] relayer account ${ACCOUNT_ID} (${final})`);
  }

  const apiKey = (root.match(/^RELAYER_API_KEY=(.*)$/m) || [])[1]?.trim()
    || crypto.randomBytes(32).toString('hex');

  for (const [file, text] of [
    [ROOT_ENV, root],
    [KEEPER_ENV, keeper],
  ] as const) {
    let next = text;
    next = upsertEnv(next, 'RELAYER_ACCOUNT_ID', ACCOUNT_ID);
    next = upsertEnv(next, 'RELAYER_PRIVATE_KEY', keyPair.toString());
    next = upsertEnv(next, 'RELAYER_API_KEY', apiKey);
    next = upsertEnv(next, 'RELAYER_URL', 'http://localhost:4000');
    fs.writeFileSync(file, next);
  }

  // The web server needs the keeper URL and the API key, never the relayer's
  // private key.
  web = upsertEnv(web, 'KEEPER_URL', 'http://localhost:4000');
  web = upsertEnv(web, 'RELAYER_API_KEY', apiKey);
  fs.writeFileSync(WEB_ENV, web);

  console.log(`[ok] relayer: ${ACCOUNT_ID}`);
  console.log(`[ok] public key: ${publicKey}`);
  console.log('[ok] RELAYER_* written to .env and services/keeper/.env');
  console.log('[ok] private key and API key were not printed');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
