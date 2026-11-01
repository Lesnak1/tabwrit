/**
 * Creates the four NEAR testnet accounts used by the Tab demo:
 *
 *   tab-vault.testnet      -> TabVault contract account
 *   tab-usdc.testnet       -> NEP-141 test token (faucet)
 *   tab-merchant.testnet   -> merchant / spender account
 *   tab-demo.testnet       -> demo vault owner
 *
 * Secrets are written to the local .env file only. Nothing is printed
 * except account IDs and transaction hashes.
 *
 * Usage: pnpm tsx scripts/create-testnet-accounts.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { KeyPair } from 'near-api-js';

const RPC = 'https://test.rpc.fastnear.com';
const HELPER = 'https://helper.testnet.near.org/account';
const ENV_PATH = path.resolve(process.cwd(), '.env');

type Role = {
  envPrefix: string;
  accountId: string;
  label: string;
};

const ROLES: Role[] = [
  { envPrefix: 'VAULT', accountId: 'tab-vault.testnet', label: 'TabVault contract' },
  { envPrefix: 'TOKEN', accountId: 'tab-usdc.testnet', label: 'Test USDC token' },
  { envPrefix: 'MERCHANT', accountId: 'tab-merchant.testnet', label: 'Merchant / spender' },
  { envPrefix: 'DEMO', accountId: 'tab-demo.testnet', label: 'Demo vault owner' },
  { envPrefix: 'AGENT', accountId: 'tab-agent.testnet', label: 'AI agent / spender' },
];

function parseEnv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    map.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim());
  }
  return map;
}

function upsertEnv(text: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, `${key}=${value}`);
  const suffix = text.endsWith('\n') || text.length === 0 ? '' : '\n';
  return `${text}${suffix}${key}=${value}\n`;
}

async function accountExists(accountId: string): Promise<boolean> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: accountId },
    }),
  });
  const json = await res.json();
  return !json.error;
}

async function createViaHelper(accountId: string, publicKey: string): Promise<string> {
  const res = await fetch(HELPER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`helper ${res.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

async function main() {
  let envText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const env = parseEnv(envText);

  for (const role of ROLES) {
    const accountKey = `TESTNET_${role.envPrefix}_ACCOUNT_ID`;
    const privateKeyName = `TESTNET_${role.envPrefix}_PRIVATE_KEY`;
    const configuredAccount = env.get(accountKey) || role.accountId;
    const existingKey = env.get(privateKeyName);

    if (await accountExists(configuredAccount)) {
      console.log(`[skip] ${role.label}: ${configuredAccount} already exists`);
      if (!existingKey) {
        console.warn(
          `       WARNING: ${privateKeyName} is not in .env. This account cannot be used by the deployment scripts. Set a different TESTNET_*_ACCOUNT_ID or import its key.`
        );
      }
      envText = upsertEnv(envText, accountKey, configuredAccount);
      continue;
    }

    const keyPair = existingKey
      ? KeyPair.fromString(existingKey as never)
      : KeyPair.fromRandom('ed25519');
    const publicKey = keyPair.getPublicKey().toString();

    console.log(`[create] ${role.label}: ${configuredAccount}`);
    try {
      const result = await createViaHelper(configuredAccount, publicKey);
      console.log(`         helper response: ${result.slice(0, 300)}`);
    } catch (err: any) {
      console.error(`         failed: ${err.message}`);
      process.exitCode = 1;
      continue;
    }

    envText = upsertEnv(envText, accountKey, configuredAccount);
    envText = upsertEnv(envText, privateKeyName, keyPair.toString());
    fs.writeFileSync(ENV_PATH, envText);
    console.log(`         key written to .env (${privateKeyName})`);
  }

  fs.writeFileSync(ENV_PATH, envText);
  console.log('\nDone. Secrets are only in .env (gitignored).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
