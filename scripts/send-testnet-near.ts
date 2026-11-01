/**
 * Sends testnet NEAR from the demo owner account to a teammate/judge wallet
 * so they can pay gas on the testnet demo.
 *
 * Usage:
 *   pnpm testnet:fund <your-account.testnet> 2
 *
 * This is a testnet-only transaction. It never touches mainnet.
 */
import 'dotenv/config';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair, utils } = nearAPI;

const recipient = process.argv[2];
const amount = process.argv[3] || '2';
const sender = process.env.TESTNET_DEMO_ACCOUNT_ID || 'tab-demo.testnet';
const privateKey = process.env.TESTNET_DEMO_PRIVATE_KEY;
const rpc = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';

if (!recipient) {
  console.error('Usage: pnpm testnet:fund <your-account.testnet> [amountNear]');
  process.exit(1);
}
if (!privateKey) {
  console.error('Missing TESTNET_DEMO_PRIVATE_KEY in .env.');
  process.exit(1);
}

async function main() {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', sender, KeyPair.fromString(privateKey as never));
  const near = await connect({ networkId: 'testnet', nodeUrl: rpc, keyStore });
  const account = await near.account(sender);

  const deposit = utils.format.parseNearAmount(amount);
  if (!deposit) throw new Error(`Invalid NEAR amount: ${amount}`);

  const outcome = await account.sendMoney(recipient, deposit as never);
  console.log(
    `Sent ${amount} testnet NEAR from ${sender} to ${recipient}: https://testnet.nearblocks.io/txns/${outcome.transaction.hash}`
  );
  console.log('Now open http://localhost:3005/app and use the faucet for test tUSDC.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
