# DEPLOYMENT.md — TabWrit web hosting and the testnet/mainnet boundary

This guide covers the web app and the optional keeper. Contract deployment is
covered by the scripts in `scripts/`; the mainnet steps require the human's
explicit approval and are not automated.

Run `pnpm release:preflight` before any push or deploy. The human-gated
sequence is kept locally with the submission notes, not in the public
repository.

Keep the hosted web app and keeper up through **2026-11-18**, ideally
**2026-11-25**: the live hackathon rules say a hosted demo is a plus and judges
may open it during and after judging.

---

## 1. Web app on Vercel (or any Node 20 host)

**Repository root:** the monorepo root, not `apps/web`.
**Install command:** `pnpm install --frozen-lockfile`
**Build command:** `pnpm --filter web build`
**Output directory:** `apps/web/.next`
**Framework preset:** Next.js
**Runtime:** Node.js 20+

`vercel.json` already sets the build command and output directory. If Vercel
rejects the output directory because of the Next.js preset, remove
`outputDirectory` from `vercel.json` and let the preset find `.next`; keep the
build command.

Environment variables:

```text
NEXT_PUBLIC_NEAR_NETWORK=testnet
NEXT_PUBLIC_NEAR_RPC_URL=https://test.rpc.fastnear.com
NEXT_PUBLIC_TAB_VAULT_CONTRACT_ID=tab-vault.testnet
NEXT_PUBLIC_TAB_TOKEN_ID=tab-usdc.testnet
NEXT_PUBLIC_TAB_TOKEN_SYMBOL=tUSDC
NEXT_PUBLIC_TAB_TOKEN_DECIMALS=6
NEXT_PUBLIC_MERCHANT_ACCOUNT_ID=tab-merchant.testnet
NEXT_PUBLIC_AGENT_ACCOUNT_ID=tab-agent.testnet
NEXT_PUBLIC_MERCHANT_INVOICE_AMOUNT=10000000
NEXT_PUBLIC_DEMO_ACCOUNT_ID=tab-demo.testnet

# Server-only testnet defaults. Override for another deployment.
NEAR_NETWORK=testnet
NEAR_RPC_URL=https://test.rpc.fastnear.com
TAB_VAULT_CONTRACT_ID=tab-vault.testnet
TAB_TOKEN_ID=tab-usdc.testnet
MERCHANT_ACCOUNT_ID=tab-merchant.testnet

# Server-only. Function-Call key on tab-merchant.testnet scoped to
# tab-vault.testnet::charge. Never prefix it with NEXT_PUBLIC_.
MERCHANT_CHARGE_PRIVATE_KEY=ed25519:...

# Server-only. NEP-366 gasless merchant charge. The keeper must be reachable
# from the web server; RELAYER_API_KEY is the keeper's relay credential.
KEEPER_URL=https://your-keeper.example.com
RELAYER_API_KEY=

# Server-only, for the mainnet quote preview.
ONECLICK_API_URL=https://1click.chaindefuser.com
ONECLICK_REFUND_ACCOUNT=near.near
ONECLICK_JWT=
```

Notes:

- `NEXT_PUBLIC_*` values are embedded in the browser bundle. They are public
  addresses, not secrets.
- `MERCHANT_CHARGE_PRIVATE_KEY` is read only by the server route. The browser
  never receives it.
- `KEEPER_URL` and `RELAYER_API_KEY` are read only by the server route. The
  browser sees a `gaslessAvailable` boolean, never the key. If the keeper is
  unreachable, the gasless route returns an error; the direct route still
  works.
- The gasless path signs a NEP-366 delegate with the merchant's scoped key and
  sends it to the keeper. The merchant account needs no NEAR for gas. The
  keeper's relayer key is separate and only pays gas.
- If you do not host the keeper, leave `RELAYER_API_KEY` unset. The merchant
  page then hides the gasless toggle and uses the direct on-chain route; it
  does not show a broken gasless option.
- The merchant route has `maxDuration = 30`. On Vercel Hobby the platform may
  cap it lower; the charge usually completes in a few seconds. If your host
  kills the function, the transaction may still be on-chain; the nonce
  prevents a duplicate.
- The server route's idempotency cache is in memory. Production merchants must
  persist invoice IDs in their own database and reconcile the on-chain
  `charge_executed` event.
- The x402-style paid API (`scripts/x402-api.ts`) is **not** deployed with the
  web app. It is a local demo server bound to `127.0.0.1`, with an in-memory
  invoice store. Do not expose it publicly without TLS, authentication, rate
  limits and durable invoice storage.

### Hosting without the merchant key

The app still works for the owner flow (connect, faucet, deposit, create,
pause, revoke, withdraw) and shows a clear configuration notice on
`/merchant`. It does not fake a payment. The committed 23/23 evidence and
`/lab` page remain available.

---

## 2. Testnet bootstrap

The account names in `.env.example` are the author's live demo accounts. For a
fresh deployment, choose your own names first.

```bash
cp .env.example .env
# edit the TESTNET_*_ACCOUNT_ID names if you do not want the demo names
pnpm testnet:setup
pnpm testnet:e2e

# Optional gasless rail: create the gas-only relayer and start the keeper
pnpm tsx scripts/create-relayer.ts
pnpm --filter keeper dev
pnpm test:meta
pnpm test:agent-attack
```

`create-testnet-accounts.ts` uses the NEAR testnet helper to create/fund the
accounts. `deploy-testnet.ts` deploys the token and vault, registers the vault,
and calls the public faucet. `setup-spender-key.ts` adds the merchant and
agent Function-Call keys scoped to `charge`. `create-relayer.ts` creates
`tab-relayer.testnet` and writes `RELAYER_*` to the gitignored `.env` files.
It also writes `KEEPER_URL` and `RELAYER_API_KEY` (never the relayer private
key) to `apps/web/.env.local`, so the gasless toggle can find the keeper. The
relayer has a FullAccess key on its own account only; it never holds an owner
or merchant key.

After the final contract is deployed:

```bash
pnpm tsx scripts/lock-vault.ts   # deletes the vault's full-access key(s)
```

The vault then has 0 keys and cannot be upgraded. Do this only when you are
done changing the contract.

---

## 3. Mainnet (human approval required)

Do **not** run these steps without the human's explicit "yes" in the current
conversation. They deploy to mainnet and can spend real tokens.

1. Create a mainnet NEAR account with enough NEAR for storage/gas and USDC for
   a small settlement.
2. Deploy `tab_vault.wasm` with `allowed_tokens = [mainnet USDC]`.
3. Register the vault on the mainnet USDC token (NEP-145).
4. Add a Function-Call key for the merchant storage/charge account, scoped to
   `charge`.
5. Fund a small storage registrar account (separate full-access key) for
   1Click deposit addresses, or pre-register them.
6. Run the vault through a tiny charge before opening it to users.
7. Delete the vault deployer key.

Set the web app's `NEAR_NETWORK=mainnet`, `NEXT_PUBLIC_NEAR_NETWORK=mainnet`,
mainnet RPC, mainnet token and merchant account. The 1Click quote preview
becomes a mainnet route; the keeper's `/charge` path becomes usable.

Mainnet risks that are **not** covered by the testnet evidence:

- Real 1Click solver behavior and settlement latency.
- Mainnet USDC storage costs and NEP-145 registration.
- Real market movement between quote and deposit.
- Mainnet token contract behavior under load.
- A mainnet NEP-366 relayer: the testnet relayer is sponsor-funded and
  testnet-only. A production relayer needs a fee/sponsorship policy, a
  monitored gas balance, abuse controls and an incident runbook.
- An independent security audit is still required for meaningful TVL.

---

## 4. Optional keeper

The keeper is a separate Node service. It is not required for the testnet
demo. To run it on mainnet:

```bash
cp services/keeper/.env.example services/keeper/.env
# fill the mainnet values, KEEPER_API_KEY, TAB_WEBHOOK_SECRET,
# MERCHANT_CHARGE_PRIVATE_KEY and the storage registrar
# for the gasless rail also fill RELAYER_ACCOUNT_ID / RELAYER_PRIVATE_KEY /
# RELAYER_API_KEY
pnpm --filter keeper build
pnpm --filter keeper start
# in another terminal:
pnpm test:keeper
```

For a hosted testnet keeper, run the compiled service with
`node services/keeper/dist/server.js` after `pnpm --filter keeper build`. Set
`KEEPER_CORS_ORIGIN` to the Vercel URL and let the host provide `PORT`.

### Render free keeper (recommended)

Render's Hobby workspace is free and includes 750 instance hours per month,
512 MB RAM and a Node runtime. A free web service spins down after 15 minutes
without traffic and wakes on the next request (about one minute). The
filesystem is ephemeral, so `relay-usage.json` resets on restart; that is
acceptable for the demo. See https://render.com/docs/free (checked 2026-11-01).

The repository contains [`render.yaml`](../render.yaml). In the Render
dashboard:

1. **New -> Blueprint**.
2. Connect `https://github.com/Lesnak1/tabwrit` and select the `render.yaml`.
3. Apply the Blueprint. Render creates `tabwrit-keeper` on the **free** plan.
4. Fill the `sync: false` values from the local `.env`:
   `MERCHANT_CHARGE_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `RELAYER_API_KEY`.
   The generated `KEEPER_API_KEY` and `TAB_WEBHOOK_SECRET` stay in Render.
5. Wait for the build and open the `onrender.com` URL.
6. Test `https://<keeper>.onrender.com/health` and an authenticated
   `/relay/status`.
7. After Vercel is live, set `KEEPER_CORS_ORIGIN` to the Vercel URL and
   redeploy/restart the keeper.

Free-tier caveats:

- 750 instance hours are enough for one service at ~720-744 hours/month; do not
  add a second free service that must stay awake.
- A keep-alive ping every 10 minutes to `/health` (for example UptimeRobot)
  keeps the service warm and stays within one service's hours.
- Free services are for demos, not production; do not use them for real funds.
- `RELAYER_PRIVATE_KEY` must exist only on Render, never in the web app.

Security:

- `/charge` requires `Authorization: Bearer <KEEPER_API_KEY>`.
- `/relay/delegate` requires `Authorization: Bearer <RELAYER_API_KEY>` and
  only relays a validated NEP-366 `charge` delegate. It refuses FullAccess
  keys, other methods, other receivers, deposits, stale nonces and expired
  block windows.
- `/relay/usage` requires the same key and reports the relayer's actual NEAR
  balance delta per sender. The `relay-usage.json` file is gitignored. A
  production deployment should compare this usage with a prepaid credit
  balance; the testnet build meters but does not enforce credits.
- The relayer key is a FullAccess key on `tab-relayer.testnet` only. Keep its
  balance small and monitor it; it is not an owner or merchant key.
- CORS is restricted to `KEEPER_CORS_ORIGIN`.
- The keeper returns 501 on testnet for the 1Click `/charge` path; it never
  pretends to settle 1Click on testnet. The NEP-366 relayer is a separate
  testnet path.
- The webhook secret is required; there is no hardcoded fallback.
- A Function-Call key cannot attach the NEP-145 storage deposit, so the
  storage registrar is a separate low-balance full-access account. Do not give
  it more NEAR than the registration budget.

---

## 5. What the deployed environment must never contain

- The owner's private key.
- A full-access key for the vault after locking.
- The merchant's scoped key in a `NEXT_PUBLIC_*` variable.
- A committed `.env`, `receipts.json`, seed phrase or wallet export.
- A fabricated settlement screenshot or a fallback "live" balance.
