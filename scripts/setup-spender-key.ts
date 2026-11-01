/**
 * Adds a Function-Call Access Key to a spender account, scoped to
 * `<vault>::charge`, and stores its private key in .env.
 *
 * Usage:
 *   pnpm tsx scripts/setup-spender-key.ts merchant
 *   pnpm tsx scripts/setup-spender-key.ts agent
 *
 * The account's full-access key stays in .env for testnet administration.
 * The automated spender uses only the scoped key.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair, utils } = nearAPI;

const role = (process.argv[2] || 'merchant').toLowerCase();
const prefix = role.toUpperCase();
const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const ACCOUNT = process.env[`TESTNET_${prefix}_ACCOUNT_ID`];
const ACCOUNT_KEY = process.env[`TESTNET_${prefix}_PRIVATE_KEY`];
const VAULT = process.env.TESTNET_VAULT_ACCOUNT_ID;
const CHARGE_ENV = `TESTNET_${prefix}_CHARGE_PRIVATE_KEY`;
const ENV_PATH = path.resolve(process.cwd(), '.env');

if (!ACCOUNT || !ACCOUNT_KEY || !VAULT) {
  console.error(`Missing TESTNET_${prefix}_ACCOUNT_ID / PRIVATE_KEY / VAULT in .env`);
  process.exit(1);
}

function upsertEnv(text: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, `${key}=${value}`);
  return `${text}${text.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
}

async function main() {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', ACCOUNT, KeyPair.fromString(ACCOUNT_KEY as never));
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore });
  const account = await near.account(ACCOUNT);

  const keys = await account.getAccessKeys();
  const alreadyScoped = keys.some(
    (k) =>
      typeof k.access_key.permission === 'object' &&
      k.access_key.permission.FunctionCall?.receiver_id === VAULT &&
      k.access_key.permission.FunctionCall?.method_names.includes('charge')
  );

  if (alreadyScoped) {
    console.log(`[skip] ${role}: a scoped charge key already exists on ${ACCOUNT}.`);
    if (!process.env[CHARGE_ENV]) {
      console.warn(
        `       ${CHARGE_ENV} is not in .env. If you no longer have the private key, create a new one.`
      );
    }
  } else {
    const keyPair = KeyPair.fromRandom('ed25519');
    const publicKey = keyPair.getPublicKey().toString();
    const allowance = utils.format.parseNearAmount('5');
    const tx = await account.addKey(publicKey, VAULT, ['charge'], allowance);
    console.log(`[add] ${role}: Function-Call key ${publicKey}`);
    console.log(`      scoped to ${VAULT}::charge, allowance 5 NEAR`);
    console.log(`      tx: https://testnet.nearblocks.io/txns/${tx.transaction.hash}`);

    const envText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    fs.writeFileSync(ENV_PATH, upsertEnv(envText, CHARGE_ENV, keyPair.toString()));
    console.log(`      private key written to .env as ${CHARGE_ENV}`);
  }

  const updated = await account.getAccessKeys();
  console.log(`\n${role} keys on-chain:`);
  for (const k of updated) {
    const permission = k.access_key.permission;
    if (typeof permission === 'string') {
      console.log(`  ${k.public_key} -> ${permission}`);
    } else {
      console.log(
        `  ${k.public_key} -> FunctionCall(${permission.FunctionCall.receiver_id}, [${permission.FunctionCall.method_names.join(
          ', '
        )}])`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
