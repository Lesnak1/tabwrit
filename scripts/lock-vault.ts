/**
 * Final immutability step: delete every full-access key from the TabVault
 * account. After this, the contract cannot be upgraded or replaced by the
 * deployer. The contract can still receive NEAR and serve users.
 *
 * Usage: pnpm tsx scripts/lock-vault.ts
 */
import 'dotenv/config';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair } = nearAPI;

const accountId = process.env.TESTNET_VAULT_ACCOUNT_ID;
const privateKey = process.env.TESTNET_VAULT_PRIVATE_KEY;
const rpc = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';

if (!accountId || !privateKey) {
  console.error('Missing TESTNET_VAULT_ACCOUNT_ID / TESTNET_VAULT_PRIVATE_KEY.');
  process.exit(1);
}

async function main() {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', accountId, KeyPair.fromString(privateKey as never));
  const near = await connect({ networkId: 'testnet', nodeUrl: rpc, keyStore });
  const account = await near.account(accountId);

  const before = await account.getAccessKeys();
  const fullAccess = before.filter((k) => k.access_key.permission === 'FullAccess');
  console.log(`[lock] ${accountId} has ${before.length} access key(s), ${fullAccess.length} full-access.`);

  for (const key of fullAccess) {
    const tx = await account.deleteKey(key.public_key);
    console.log(
      `[lock] deleted ${key.public_key}: https://testnet.nearblocks.io/txns/${tx.transaction.hash}`
    );
  }

  const after = await account.getAccessKeys();
  console.log(`[lock] ${accountId} now has ${after.length} access key(s).`);
  for (const key of after) {
    console.log(`  ${key.public_key} -> ${JSON.stringify(key.access_key.permission)}`);
  }
  if (after.length !== 0) {
    console.warn('[lock] WARNING: keys remain; the contract is not fully immutable.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
