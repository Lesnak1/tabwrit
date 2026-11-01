/**
 * Keeps the local .env pointed at the current testnet deployment and the
 * scoped agent key. Secrets are read from the TESTNET_* entries and written
 * back without being printed.
 *
 * Usage: pnpm tsx scripts/sync-env.ts
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.resolve(process.cwd(), '.env');
let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';

function parse(input: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    map.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim());
  }
  return map;
}

function upsert(key: string, value: string) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) {
    text = text.replace(re, `${key}=${value}`);
  } else {
    text += `${text.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
  }
}

const env = parse(text);
const agentKey = env.get('TESTNET_AGENT_CHARGE_PRIVATE_KEY');
const merchantKey = env.get('TESTNET_MERCHANT_CHARGE_PRIVATE_KEY');
if (!agentKey || !merchantKey) {
  console.error('Missing TESTNET_AGENT_CHARGE_PRIVATE_KEY or TESTNET_MERCHANT_CHARGE_PRIVATE_KEY. Run setup-spender-key first.');
  process.exit(1);
}

const updates: Record<string, string> = {
  NEAR_NETWORK: 'testnet',
  NEAR_RPC_URL: 'https://test.rpc.fastnear.com',
  NEAR_ACCOUNT_ID: env.get('TESTNET_AGENT_ACCOUNT_ID') || 'tab-agent.testnet',
  NEAR_PRIVATE_KEY: agentKey,
  TAB_VAULT_CONTRACT_ID: env.get('TESTNET_VAULT_ACCOUNT_ID') || 'tab-vault.testnet',
  TAB_TOKEN_ID: env.get('TESTNET_TOKEN_ACCOUNT_ID') || 'tab-usdc.testnet',
  MERCHANT_ACCOUNT_ID: env.get('TESTNET_MERCHANT_ACCOUNT_ID') || 'tab-merchant.testnet',
  AGENT_ACCOUNT_ID: env.get('TESTNET_AGENT_ACCOUNT_ID') || 'tab-agent.testnet',
  ONECLICK_API_URL: 'https://1click.chaindefuser.com',
  ONECLICK_REFUND_ACCOUNT: env.get('ONECLICK_REFUND_ACCOUNT') || 'near.near',
  KEEPER_API_KEY: env.get('KEEPER_API_KEY') || crypto.randomBytes(32).toString('hex'),
  TAB_WEBHOOK_SECRET: env.get('TAB_WEBHOOK_SECRET') || `whsec_${crypto.randomBytes(24).toString('hex')}`,
};

for (const [key, value] of Object.entries(updates)) upsert(key, value);
fs.writeFileSync(ENV_PATH, text);
console.log('Updated .env keys (values not printed):');
for (const key of Object.keys(updates)) console.log(`  ${key}`);
