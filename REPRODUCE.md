# REPRODUCE.md — TabWrit fresh clone to a real testnet stack

This repository has two levels of reproduction:

1. **No keys:** run the contract tests, print the committed evidence, build
   the web app, and verify the MCP read tools.
2. **Full testnet:** create your own testnet accounts, deploy the token and
   vault, add scoped keys, create a gas-only relayer, and re-run the labs.

The committed evidence is real; the author's private keys are not in the
repository. Do not commit `.env` files.

---

## 1. Fresh clone, no keys

```bash
pnpm install
pnpm test                 # 16 real Rust VM tests
pnpm demo                 # committed 23/23 evidence with NearBlocks links
pnpm --filter web build   # production Next.js build
pnpm test:mcp             # 6 MCP tools; live testnet read views
```

`pnpm demo` needs no network and no keys. `pnpm test:mcp` reads live testnet
state; it does not sign a transaction.

---

## 2. Full testnet from zero

### 2.1 Choose your own names

```bash
cp .env.example .env
```

The `TESTNET_*_ACCOUNT_ID` values in `.env.example` are the author's live demo
accounts. **Change them** to names you control, for example:

```text
TESTNET_VAULT_ACCOUNT_ID=my-tab-vault.testnet
TESTNET_TOKEN_ACCOUNT_ID=my-tab-usdc.testnet
TESTNET_MERCHANT_ACCOUNT_ID=my-tab-merchant.testnet
TESTNET_DEMO_ACCOUNT_ID=my-tab-demo.testnet
TESTNET_AGENT_ACCOUNT_ID=my-tab-agent.testnet
RELAYER_ACCOUNT_ID=my-tab-relayer.testnet
```

If you leave the author's names, the helper will skip the existing accounts
and you will not have their private keys. The setup will not be usable.

### 2.2 Create, deploy and scope keys

```bash
pnpm testnet:setup
pnpm tsx scripts/sync-env.ts
```

`testnet:setup` creates the accounts with the NEAR testnet helper, deploys the
test token and vault, and adds Function-Call keys scoped to
`<vault>::charge` for the merchant and agent. `sync-env.ts` points the root
`.env` at the new deployment without printing secrets.

After the final deployment, lock the vault:

```bash
pnpm tsx scripts/lock-vault.ts
```

Only run this when you are done changing the contract. It deletes the vault's
full-access key and makes the contract immutable.

### 2.3 Create the gas-only relayer and configure the keeper

Copy both env templates first, then let `create-relayer.ts` fill the relayer
values into them:

```bash
cp services/keeper/.env.example services/keeper/.env
cp apps/web/.env.example apps/web/.env.local
pnpm tsx scripts/create-relayer.ts
```

If you copy either template **after** this step, it will overwrite
`KEEPER_URL` / `RELAYER_API_KEY`; re-run `create-relayer.ts` or fill them
manually.

Fill `services/keeper/.env` with the testnet values:

```text
NEAR_NETWORK=testnet
NEAR_RPC_URL=https://test.rpc.fastnear.com
TAB_VAULT_CONTRACT_ID=<your vault>
TAB_TOKEN_ID=<your token>
MERCHANT_ACCOUNT_ID=<your merchant>
MERCHANT_CHARGE_PRIVATE_KEY=<from the root .env>
RELAYER_ACCOUNT_ID=<your relayer>
RELAYER_PRIVATE_KEY=<from the root .env>
RELAYER_API_KEY=<from the root .env>
KEEPER_API_KEY=<any long random value>
```

`create-relayer.ts` also writes `KEEPER_URL` and `RELAYER_API_KEY` to
`apps/web/.env.local`; it never writes the relayer private key there.

Start the keeper:

```bash
pnpm --filter keeper dev
```

### 2.4 Run the labs

```bash
pnpm testnet:e2e
pnpm test:meta
pnpm test:relayer-usage
pnpm test:x402
```

`pnpm test:x402` starts four local HTTP servers on ephemeral `127.0.0.1`
ports. They never listen on a public interface and keep no private key.

With the web app running:

```bash
# apps/web/.env.local already exists; fill MERCHANT_CHARGE_PRIVATE_KEY.
# KEEPER_URL and RELAYER_API_KEY were written by create-relayer.ts.
pnpm dev:web
pnpm test:web-gasless
pnpm test:agent-attack
```

If you do not host the keeper, leave `RELAYER_API_KEY` unset in the web
environment. The merchant page hides the gasless toggle and uses the direct
on-chain route; it never shows a broken gasless option.

---

## 3. Which commands need what

| Command | Needs author keys? | Needs keeper/web? | Writes transactions? |
| :--- | :---: | :---: | :---: |
| `pnpm test` | No | No | No |
| `pnpm demo` | No | No | No |
| `pnpm --filter web build` | No | No | No |
| `pnpm test:mcp` | No | No | No |
| `pnpm testnet:e2e` | Yes, your own | No | Yes, testnet |
| `pnpm test:tester` | Yes, your own | No | Yes, testnet |
| `pnpm test:meta` | Yes, your own | Keeper | Yes, testnet |
| `pnpm test:relayer-usage` | Yes, your own | Keeper | No |
| `pnpm test:web-gasless` | Yes, your own | Keeper + web | Yes, testnet |
| `pnpm test:agent-attack` | Yes, your own | No | Yes, testnet |
| `pnpm test:x402` | Yes, your own | No | Yes, testnet |
| `pnpm test:keeper` | Yes, your own | Keeper | No |

---

## 4. Security notes

- Never commit `.env`, `services/keeper/.env`, `apps/web/.env.local`,
  `relay-usage.json` or `receipts.json`.
- Before pushing, check:

  ```bash
  git status --short
  git grep -n "ed25519:"
  ```

- Use the git CLI, not a web upload that may include hidden files.
- The testnet keys control testnet-only accounts and tokens. They have no
  mainnet value, but they are still secrets; rotate them if the folder or a
  zip was shared.
