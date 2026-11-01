/**
 * Deploys the Tab testnet stack:
 *   1. NEP-141 test token (tab-usdc.testnet)
 *   2. TabVault contract (tab-vault.testnet)
 *   3. Registers the vault and demo/merchant accounts with the token
 *   4. Mints test USDC to the demo owner and merchant
 *
 * Usage: pnpm tsx scripts/deploy-testnet.ts
 *
 * Secrets live only in .env. The script never prints a private key.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair } = nearAPI;

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const NETWORK = 'testnet';

const TOKEN_ACCOUNT = process.env.TESTNET_TOKEN_ACCOUNT_ID;
const TOKEN_KEY = process.env.TESTNET_TOKEN_PRIVATE_KEY;
const VAULT_ACCOUNT = process.env.TESTNET_VAULT_ACCOUNT_ID;
const VAULT_KEY = process.env.TESTNET_VAULT_PRIVATE_KEY;
const DEMO_ACCOUNT = process.env.TESTNET_DEMO_ACCOUNT_ID;
const MERCHANT_ACCOUNT = process.env.TESTNET_MERCHANT_ACCOUNT_ID;
const AGENT_ACCOUNT = process.env.TESTNET_AGENT_ACCOUNT_ID;

if (!TOKEN_ACCOUNT || !TOKEN_KEY || !VAULT_ACCOUNT || !VAULT_KEY || !DEMO_ACCOUNT || !MERCHANT_ACCOUNT) {
  console.error(
    'Missing TESTNET_* variables. Run scripts/create-testnet-accounts.ts first and check .env.'
  );
  process.exit(1);
}

const ROOT = process.cwd();
const TOKEN_WASM = path.join(
  ROOT,
  'contracts/nep141-token/target/wasm32-unknown-unknown/release/nep141_token.wasm'
);
const VAULT_WASM = path.join(
  ROOT,
  'contracts/tab-vault/target/wasm32-unknown-unknown/release/tab_vault.wasm'
);

function requireFile(file: string) {
  if (!fs.existsSync(file)) {
    console.error(`Missing WASM: ${file}`);
    console.error('Run the corresponding cargo build first (see README).');
    process.exit(1);
  }
  return fs.readFileSync(file);
}

async function accountFor(accountId: string, secretKey: string) {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(NETWORK, accountId, KeyPair.fromString(secretKey as never));
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore });
  return near.account(accountId);
}

function explorer(txHash: string) {
  return `https://testnet.nearblocks.io/txns/${txHash}`;
}

async function main() {
  const tokenWasm = requireFile(TOKEN_WASM);
  const vaultWasm = requireFile(VAULT_WASM);

  const tokenAccount = await accountFor(TOKEN_ACCOUNT, TOKEN_KEY);
  const vaultAccount = await accountFor(VAULT_ACCOUNT, VAULT_KEY);
  const demoAccount = await accountFor(DEMO_ACCOUNT, process.env.TESTNET_DEMO_PRIVATE_KEY as string);
  const merchantAccount = await accountFor(
    MERCHANT_ACCOUNT,
    process.env.TESTNET_MERCHANT_PRIVATE_KEY as string
  );
  const agentAccount = AGENT_ACCOUNT
    ? await accountFor(AGENT_ACCOUNT, process.env.TESTNET_AGENT_PRIVATE_KEY as string)
    : null;

  // 1. Token
  const tokenState = await tokenAccount.state();
  if (tokenState.code_hash === '11111111111111111111111111111111') {
    console.log('[1/5] Deploying test token...');
    const tx = await tokenAccount.deployContract(tokenWasm);
    console.log(`      deploy: ${explorer(tx.transaction.hash)}`);
    const init = await tokenAccount.functionCall({
      contractId: TOKEN_ACCOUNT,
      methodName: 'new_default_meta',
      args: {
        owner_id: TOKEN_ACCOUNT,
        total_supply: '1000000000000', // 1,000,000 tUSDC
      },
      gas: BigInt('50000000000000'),
      attachedDeposit: BigInt(0),
    });
    console.log(`      init:   ${explorer(init.transaction.hash)}`);
  } else {
    console.log('[1/5] Test token already deployed; skipping deploy.');
  }

  // 2. Vault
  const vaultState = await vaultAccount.state();
  if (vaultState.code_hash === '11111111111111111111111111111111') {
    console.log('[2/5] Deploying TabVault...');
    const tx = await vaultAccount.deployContract(vaultWasm);
    console.log(`      deploy: ${explorer(tx.transaction.hash)}`);
    const init = await vaultAccount.functionCall({
      contractId: VAULT_ACCOUNT,
      methodName: 'new',
      args: { allowed_tokens: [TOKEN_ACCOUNT] },
      gas: BigInt('50000000000000'),
      attachedDeposit: BigInt(0),
    });
    console.log(`      init:   ${explorer(init.transaction.hash)}`);
  } else {
    console.log('[2/5] TabVault already deployed; skipping deploy.');
  }

  // 3. Register the vault with the token. On a rerun the vault may already
  // be registered, and after the final deployment the vault account has no
  // key (the contract is immutable), so check the view first.
  console.log('[3/5] Registering the vault with the test token...');
  const provider = new nearAPI.providers.JsonRpcProvider({ url: RPC });
  const storageRes: any = await provider.query({
    request_type: 'call_function',
    account_id: TOKEN_ACCOUNT,
    method_name: 'storage_balance_of',
    args_base64: Buffer.from(
      JSON.stringify({ account_id: VAULT_ACCOUNT })
    ).toString('base64'),
    finality: 'optimistic',
  });
  const storageText = Buffer.from(storageRes.result).toString('utf8');
  const storage = storageText ? JSON.parse(storageText) : null;

  if (storage) {
    console.log('      vault is already registered; skipping storage_deposit');
  } else {
    const reg = await vaultAccount
      .functionCall({
        contractId: TOKEN_ACCOUNT,
        methodName: 'storage_deposit',
        args: { account_id: VAULT_ACCOUNT, registration_only: true },
        gas: BigInt('30000000000000'),
        attachedDeposit: BigInt('12500000000000000000000'), // 0.0125 NEAR
      })
      .catch((err: any) => {
        if (String(err.message).includes('already registered')) return null;
        throw err;
      });
    if (reg) console.log(`      register: ${explorer(reg.transaction.hash)}`);
  }

  // 4. Faucet for the demo owner and the merchant. This both registers them
  // and gives them test USDC.
  console.log('[4/5] Funding demo, merchant and agent accounts from the faucet...');
  const faucetAccounts = [demoAccount, merchantAccount, agentAccount].filter(
    Boolean
  ) as nearAPI.Account[];
  for (const account of faucetAccounts) {
    const tx = await account.functionCall({
      contractId: TOKEN_ACCOUNT,
      methodName: 'faucet',
      args: {},
      gas: BigInt('30000000000000'),
      attachedDeposit: BigInt(0),
    });
    console.log(`      ${account.accountId}: ${explorer(tx.transaction.hash)}`);
  }

  // 5. Print the public configuration.
  console.log('\n[5/5] Testnet configuration:');
  console.log(`      TOKEN:  ${TOKEN_ACCOUNT}`);
  console.log(`      VAULT:  ${VAULT_ACCOUNT}`);
  console.log(`      DEMO:   ${DEMO_ACCOUNT}`);
  console.log(`      MERCHANT: ${MERCHANT_ACCOUNT}`);
  if (AGENT_ACCOUNT) console.log(`      AGENT:  ${AGENT_ACCOUNT}`);
  console.log('\nAdd these to .env / hosting env:');
  console.log(`      NEXT_PUBLIC_NEAR_NETWORK=testnet`);
  console.log(`      NEXT_PUBLIC_TAB_VAULT_CONTRACT_ID=${VAULT_ACCOUNT}`);
  console.log(`      NEXT_PUBLIC_TAB_TOKEN_ID=${TOKEN_ACCOUNT}`);
  console.log(`      TAB_VAULT_CONTRACT_ID=${VAULT_ACCOUNT}`);
  console.log(`      TAB_TOKEN_ID=${TOKEN_ACCOUNT}`);
  console.log(`      MERCHANT_ACCOUNT_ID=${MERCHANT_ACCOUNT}`);
  if (AGENT_ACCOUNT) console.log(`      NEXT_PUBLIC_AGENT_ACCOUNT_ID=${AGENT_ACCOUNT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
