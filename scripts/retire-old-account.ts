/**
 * Retires the superseded testnet deployer account by deleting its full-access
 * key. The old contract is left immutable; it is not used by the current
 * deployment. This is testnet hygiene after the deployer key was found in a
 * source file during the audit.
 *
 * Usage: pnpm tsx scripts/retire-old-account.ts
 */
import 'dotenv/config';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair } = nearAPI;

const accountId = process.env.KEEPER_ACCOUNT_ID;
const privateKey = process.env.KEEPER_PRIVATE_KEY;
const rpc = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';

if (!accountId || !privateKey) {
  console.log('No legacy KEEPER_ACCOUNT_ID/KEEPER_PRIVATE_KEY in .env; nothing to retire.');
  process.exit(0);
}

async function main() {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', accountId, KeyPair.fromString(privateKey as never));
  const near = await connect({ networkId: 'testnet', nodeUrl: rpc, keyStore });
  const account = await near.account(accountId);

  const keys = await account.getAccessKeys();
  const fullAccess = keys.filter((k) => k.access_key.permission === 'FullAccess');
  if (fullAccess.length === 0) {
    console.log(`[skip] ${accountId} has no full-access key.`);
  }
  for (const key of fullAccess) {
    const tx = await account.deleteKey(key.public_key);
    console.log(
      `[retire] deleted ${key.public_key} from ${accountId}: https://testnet.nearblocks.io/txns/${tx.transaction.hash}`
    );
  }
  const after = await account.getAccessKeys();
  console.log(`[retire] ${accountId} now has ${after.length} access key(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
