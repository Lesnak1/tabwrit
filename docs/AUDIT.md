# AUDIT.md — Independent-style review of the TabWrit repository

This document records the audit performed on 2026-10-24 before submission. It
is written by the builders, not an external auditor. Its purpose is to make
the fixes and the remaining risks inspectable.

Scope: `contracts/tab-vault`, `contracts/nep141-token`, `apps/web`,
`services/keeper`, `packages/tab-mcp`, `packages/tab-sdk`, the setup/test
scripts and the documentation.

Method:

1. Read every source file and trace the deposit, charge, callback, withdrawal
   and settlement paths.
2. Run the Rust unit/fuzz tests and the real testnet Attack Lab.
3. Compare every README claim with a reproducible command or a transaction.
4. Search for committed secrets, fake data, fallbacks and unauthenticated
   write paths.
5. Re-read the live NEAR/1Click documentation and API responses.

---

## Findings and fixes

### C1 — Hardcoded full-access private key in the web server (Critical)

**Finding.** `apps/web/src/lib/server-near.ts` contained a literal
`DEFAULT_PRIVATE_KEY` and used it as a fallback. The key was a **FullAccess**
key on the testnet contract account. The key was therefore in the repository
and in the build context.

**Impact.** Anyone with the repository could sign arbitrary transactions for
the testnet account, deploy/replace the contract and drain its NEAR balance.
It was testnet-only, but it is exactly the class of failure Tab exists to
prevent.

**Fix.**

- Removed the literal key and the fallback. `server-near.ts` now requires
  `MERCHANT_CHARGE_PRIVATE_KEY` and uses only the merchant account's
  **Function-Call** key scoped to `charge`.
- The old testnet account's full-access key was deleted on-chain. The account
  now reports **0 access keys**
  ([proof](https://testnet.nearblocks.io/txns/7TTrJmMVpRwbNkuKLh3BjoV7dHGnihhC3PfxNk3raYCt)).
- The new vault/merchant/agent accounts use freshly generated keys that live
  only in the gitignored `.env`.
- The web app's owner actions are wallet-signed; no server-side owner key
  exists.
- `.env.example` contains placeholders only.

**Verification.** `grep` for the old key and account in source returns no
match. The old account has no keys. The merchant and agent each have a
Function-Call key scoped to `tab-vault.testnet::charge` and cannot attach a
deposit.

---

### C2 — Callback rollback could erase a later in-flight charge (Critical)

**Finding.** The original `on_charge_transfer_callback` restored snapshots of
`spent_in_period`, `spent_total`, `period_index` and `charge_count` captured
before the charge. If charge B was reserved while charge A's transfer was in
flight, A's failure restored the pre-A snapshot and erased B's accounting.
The balance restore was also additive while the counters were snapshot-based,
so the ledger and caps could diverge.

**Impact.** An attacker or a busy merchant could make a failed transfer erase
a later successful charge's cap consumption, allowing more spending than the
owner authorized. It also corrupted the period index.

**Fix.**

- On failure, subtract the amount from the **current** counters, not a
  snapshot.
- Only subtract `spent_in_period` when the failed charge's period is still the
  current period.
- Rewind `next_nonce` only when the failed charge was the latest reservation;
  otherwise leave it consumed.
- Global stats and volume are incremented only on confirmed success.

**Verification.**
`tests::test_interleaved_charge_rollback_preserves_later_charge` reserves A
and B, fails A, asserts B's counters survive, then settles B and checks the
global stats. The real testnet `S10a/S10b` checks a failed NEP-141 transfer
and the restored ledger/counters.

---

### H1 — No replay/idempotency guard on charges (High)

**Finding.** The original `charge` had no nonce or unique reference; a
retried transaction could charge twice. The README claimed "nonce and
monotonic charge IDs" but the contract had neither.

**Fix.** `Tab.next_nonce` is a monotonic `u64`. `charge` requires
`nonce == next_nonce`, increments it before the token call, and only rewinds
it on failure when it was the latest reservation. A rejected policy does not
consume the nonce, so the spender can correct the request.

**Verification.** `test_nonce_replay_rejected`, testnet `S11a/S11b`.

---

### H2 — Unauthenticated write endpoints in the keeper and web app (High)

**Finding.** `/api/charge`, `/api/tab/create`, `/api/tab/status` and keeper
`/charge`, `/tab/create`, `/tab/status` were public. The keeper used a
privileged key and would charge any Tab that authorized it, with a
caller-chosen recipient. Owner endpoints created Tabs owned by the keeper,
not the user.

**Fix.**

- Removed the owner endpoints from the web app and keeper. Owner actions are
  wallet-signed in `/app`.
- The web app's merchant route is server-only and uses the merchant's scoped
  key; the amount and receiver are fixed by the server. The browser cannot
  redirect the payment.
- The keeper `/charge` requires `KEEPER_API_KEY`, is mainnet-only and rejects
  allowlist Tabs (which cannot work with rotating Intent deposit addresses).
- The keeper's `cors` origin is restricted.
- The server-side merchant flow has an in-process idempotency cache; the
  on-chain nonce is the authoritative replay guard.

**Verification.** `curl` without the keeper key returns 401. The web route
returns a real charge for a Tab that authorizes the merchant and rejects
Tabs that do not. Evidence:
[9VqKERqd…](https://testnet.nearblocks.io/txns/9VqKERqdHEiiF2wk6bEeV1ucSdihBLYnWnxN7pTCBcWr).

---

### H3 — Storage griefing on `create_tab` (High)

**Finding.** `create_tab` was free and unbounded. Any account could create
Tabs with huge labels and allowlists, making the contract pay storage until
it ran out of NEAR.

**Fix.** `create_tab` is `#[payable]` and requires 0.01 NEAR. Labels are
≤64 bytes, allowlists ≤20 entries, and each owner is limited to 100 Tabs.
`ft_on_transfer` still lets the contract pay for balance entries; the
allowlisted token set bounds the attack, but dust-deposit griefing remains a
documented limitation.

**Verification.** `test_create_tab_requires_storage_deposit`,
`test_create_tab_label_limit`, `get_config` returns the limits.

---

### H4 — 1Click testnet/mainnet mismatch (High)

**Finding.** The web app and keeper requested `dry: false` 1Click quotes on
testnet and sent testnet tokens to a mainnet implicit deposit address. The
keeper also rewrote `merchantRecipient` `.testnet` names to `.near`, treating
a destination-chain address as a NEAR account. The flow could never settle
and the UI implied it had.

**Fix.**

- The 1Click settlement path is explicitly **mainnet-only**. The keeper
  returns 501 on testnet.
- The testnet merchant checkout uses a real on-chain tUSDC transfer to the
  merchant account. It does not pretend to be a cross-chain settlement.
- The `/merchant` cross-chain panel calls the live 1Click API with
  `dry: true`, validates the destination address per chain, and labels the
  result `quote-only`. No deposit address is created and no funds move.
- Origin assets are resolved from the live `/v0/tokens` list; the keeper
  verifies `nep141:<token>` is listed instead of guessing.
- The quote `refundTo` must be a real mainnet account.

**Verification.** `/api/quote` returns a real Base/Ethereum/Solana quote. The
keeper testnet `/charge` returns 501 with `MAINNET_REQUIRED`.

---

### M1 — Fake "live" data and fallbacks (Medium)

**Finding.** The landing page fell back to hardcoded caps (20/50/100) and a
hardcoded Tab #3 when the RPC failed. The dashboard fell back to public Tabs
when the connected account had none and defaulted to a specific testnet
account. The merchant page fell back to `merchant.near` and invented
`2.0154 wNEAR`. The docs advertised "zero mock" while doing this.

**Fix.** Every fallback was removed. The UI shows real view-call data or an
explicit error/empty state. The dashboard only reads the connected owner's
Tabs. The merchant page requires a selected Tab and a real server response.
The landing page shows live contract stats or "unavailable."

**Verification.** With the RPC blocked, the pages show errors/empty states,
not invented values. The live landing page shows the actual tUSDC balance and
stats.

---

### M2 — Attack Lab was a simulated PASS loop (Medium)

**Finding.** The original `/lab` iterated nine scenarios, queried
`get_remaining`, and marked every row `PASS` with the expected result, even
when no transaction was sent. Some rows had no tx hash. The engine also had
`// Keep calibrated result` fallbacks. The README called it "on-chain
verification."

**Fix.** The simulated page was removed. The new lab renders the committed
`docs/evidence/testnet-e2e.json`, produced by `scripts/testnet-e2e.ts`, which
sends 23 real transactions and exits non-zero on mismatch. The web page shows
the actual result and a NearBlocks link for each row; no row is marked PASS by
the UI.

**Verification.** The evidence file contains 23 rows with real hashes. The
runner's final line is `RESULT: 23/23 real on-chain checks passed.`

---

### M3 — TypeScript model presented as contract proof (Medium)

**Finding.** The old `pnpm test` ran a TypeScript reference model and a
100,000-iteration model fuzzer, while the README claimed formal verification
of the Rust contract. The Rust fuzz file existed but was not linked into the
crate, so it never ran. The "differential" testnet lab marked any rejection
as a match.

**Fix.** The model package and the broken differential lab were removed.
`pnpm test` runs the actual Rust crate in a NEAR VM: 16 tests, including two
randomized property tests. The Rust fuzz module is linked under `#[cfg(test)]`.
The testnet runner asserts the exact expected result and fails on mismatch.

**Verification.** `cargo test` output shows 16 tests; the e2e report shows the
exact expected/actual pairs.

---

### M4 — Gasless NEP-366 flow was a serialization demo (Medium; now reimplemented for real)

**Finding.** `test-gasless.ts` generated a random key for a non-existent
account, used a mock block hash, never broadcast a transaction, and used an
invalid `receiver_policy: { Anyone: null }`. The relayer rebuilt a delegate
action and reused a signature over a different payload. The README claimed a
working gasless subscription flow.

**Fix.** The broken demo was removed. The feature was then reimplemented at
the protocol level:

- `packages/tab-sdk/src/meta-tx.ts` builds a single-action `charge`
  `DelegateAction`, signs `sha256(encodeDelegateAction)` with the sender's
  Ed25519 Function-Call key, and transports the signed delegate.
- `services/keeper/src/relayer.ts` validates the delegate (one `charge` call,
  vault receiver, zero deposit, max 100 Tgas, bounded block window, current
  access-key nonce, local signature verification, FunctionCall key scoped to
  `charge`), then submits it and pays gas.
- `/api/merchant/charge-gasless` signs with the merchant's scoped key on the
  server; the merchant needs no NEAR.
- `pnpm test:meta` → 12/12 on real testnet: the merchant and the agent both
  charge gaslessly, both NEAR balances stay unchanged, the relayer pays gas,
  the agent's prompt-injected redirect is rejected on-chain with
  `RECEIVER_NOT_ALLOWED`, and replay/tampered-signature/FullAccess-key
  delegates are refused. `pnpm test:web-gasless` → 3/3 for the browser route.

**Verification.** [`docs/evidence/meta-tx.json`](evidence/meta-tx.json),
[`docs/evidence/web-gasless.json`](evidence/web-gasless.json). The relayer is
testnet-only and sponsor-funded; that limitation is stated in the README and
SECURITY.md.

---

### M7 — Relayer could be abused as an open gas faucet (Medium, fixed during implementation)

**Finding.** An early `/relay/delegate` draft accepted any signed delegate and
relayed it without checking the key permission. An attacker could ask the
relayer to pay for a transfer or a call to another contract, draining its
testnet gas.

**Fix.** The endpoint is authenticated with `RELAYER_API_KEY`, rate-limited per
sender, and validates the delegate before spending gas: exactly one
`FunctionCall` to `<vault>::charge`, zero deposit, gas <= 100 Tgas,
`maxBlockHeight` within 200 blocks, a fresh access-key nonce, a locally
verified Ed25519 signature, and a FunctionCall access key scoped to
`<vault>::charge`. FullAccess keys are refused. The Tab preflight also checks
the spender, token and Tab nonce.

**Verification.** `pnpm test:meta` checks M7 (replay), M8 (tampered
signature) and M9 (FullAccess key) with real requests to the relayer.

---

### M8 — Prompt-injection containment was claimed but not demonstrated (Medium, fixed)

**Finding.** The contract supported a receiver allowlist, but no test proved
that a prompt-injected agent could be stopped by it. The claim was therefore
weaker than the product narrative.

**Fix.** `pnpm test:agent-attack` creates an agent Tab whose only allowed
receiver is the merchant, starts the real MCP server with the agent's scoped
key, and instructs it to pay `tab-attacker.testnet`. The contract rejects the
charge with `RECEIVER_NOT_ALLOWED`, the attacker balance stays zero and the
Tab nonce is not consumed. A subsequent legitimate merchant invoice executes.

**Verification.** 4/4 checks on testnet
([`docs/evidence/agent-attack.json`](evidence/agent-attack.json)); rejected tx
[2wKAwrNv…](https://testnet.nearblocks.io/txns/2wKAwrNvPRbWtZREobK6xZxB6iEyYhhaKVMLNgQB9fkx).
The gasless suite repeats the same attack with a signed NEP-366 delegate:
12/12, rejected tx
[Dbagm7mB…](https://testnet.nearblocks.io/txns/Dbagm7mBDcTYrDA9L4g271XBDMDig2q6fJedkfjik2zx).

---

### M5 — MCP server exposed owner actions with an agent key (Medium)

**Finding.** The MCP server exposed `tab_create_tab` and `tab_revoke_tab`
using the same private key as charging. An agent could create or revoke Tabs,
and the key was unlikely to be scoped to `charge`.

**Fix.** The MCP tool surface became four read tools plus the scoped
`tab_charge_invoice`. A later x402 task added `tab_pay_and_fetch`, which is a
payment tool, not an owner action. The agent key is a Function-Call key scoped
to `charge`; owner actions stay in the wallet. The MCP charge fetches the
current `next_nonce` before signing.

**Verification.** `pnpm test:mcp` lists six tools and reads live testnet
state. `pnpm test:mcp:charge` creates a Tab for `tab-agent.testnet` and the
MCP server pays 1 tUSDC to the merchant through `tab_charge_invoice`:
[5CeLAGec…](https://testnet.nearblocks.io/txns/5CeLAGecBQdqqtdXKEEhTzYTEUDuD6tfBuHL7PU9LN1n).
The on-chain key list for `tab-agent.testnet` shows a FunctionCall key on
`tab-vault.testnet` with `charge` only.

---

### M6 — Stale Tab list immediately after `create_tab` (Medium, found by UI E2E)

**Finding.** After a successful `create_tab`, the app showed the success
notice, but the owner-index view could briefly return a pre-create list from
the RPC load balancer. The new Tab appeared only after a manual refresh. The
contract had created the Tab; this was a UI read-after-write consistency
issue.

**Fix.** The app decodes the new Tab ID from the transaction's
`SuccessValue`, polls `get_tab` until the Tab is visible, and retries the
owner index before rendering. The test harness and docs now also avoid
assuming a single optimistic view.

**Verification.** The Playwright browser E2E (`docs/evidence/UI_E2E.md`)
passes 10/10 with 0 console errors. The fresh-wallet direct E2E
(`docs/evidence/tester-wallet-e2e.json`) passes 12/12.

---

### M9 — Stale status badge after pause/resume/revoke (Medium, found by UI E2E rerun)

**Finding.** After a confirmed pause transaction, the success notice appeared
but the Tab card could still show `Active`. The owner-index view was briefly
stale on one RPC node. The contract state was correct; the UI read was not.

**Fix.** The app polls `get_tab` until the expected status is visible, then
patches that Tab's status in the rendered list before reloading. This mirrors
the existing create-Tab read-after-write fix.

**Verification.** The rerun passes 10/10 with 0 console errors; the merchant
payment is a real gasless NEP-366 transaction
([FSsWgW2D…](https://testnet.nearblocks.io/txns/FSsWgW2DX9KYeMM1DH34v1tUaJZMdScQ5S9aVuzw6e7Z)).
See `docs/evidence/UI_E2E.md`.

---

### M10 — Relayer gas was unmeasured and sustainability was only a paragraph (Medium, fixed)

**Finding.** The NEP-366 relayer paid testnet gas, but the project did not
measure the actual cost per sender and had no revenue model. The hackathon
judging guidance includes **sustainability**, so a paragraph alone would not
be credible.

**Fix.** Added `services/keeper/src/usage.ts`, which records the relayer
account's actual NEAR balance delta per sender and exposes it through the
authenticated `GET /relay/usage` endpoint. `pnpm test:relayer-usage` verifies
401/200 and non-zero gas for the merchant and agent. Added
[`docs/SUSTAINABILITY.md`](SUSTAINABILITY.md): merchant SaaS + prepaid relayer
gas credits, no token, no custody, no fee inside the vault, no solver spread.

The contract was **not** changed. A fee inside the immutable vault is not
possible, and a Function-Call NEP-366 delegate can contain only one `charge`
action. The model therefore meters gas off-chain and can enforce prepaid
credits in the keeper.

**Verification.** `docs/evidence/relayer-usage.json` → 5/5. The earlier
controlled run measured 0.2493960178501748 NEAR for three relays (merchant +
two agent relays). The latest accumulated meter is 7 relays /
0.4995074277429292 NEAR; the meter is cumulative across test runs. Mainnet
pricing is explicitly not claimed; it must be measured.

### M11 — x402 paid API could trust a look-alike event or a replayed receipt (Medium, fixed)

**Finding.** The first x402-style prototype accepted a transaction hash and
looked for a `charge_executed` log anywhere in the receipt tree. A callee could
emit a look-alike event, and a used receipt could be presented with a new
invoice. The replay check also ran before payer verification, so a wrong payer
received a generic replay error instead of `WRONG_PAYER`.

**Fix.** The paid API now:

- only accepts a `charge_executed` event whose receipt executor is
  `tab-vault.testnet` and whose `standard` is `tab`;
- binds the payment to an invoice and requires the on-chain `reference` to
  match `x402:<invoiceId>`;
- verifies Tab, payer, receiver, asset and amount before the replay check;
- consumes both the invoice and the receipt only after successful
  verification;
- checks the client-side Tab preflight, host allowlist and HTTPS policy in
  `tab_pay_and_fetch`.

**Verification.** `pnpm test:x402` → **13/13** on real testnet transactions:
paid fetch, receipt replay, invoice replay, wrong payer, wrong amount,
over-cap, redirected receiver, and revoked Tab. Evidence:
[`docs/evidence/agent-x402.json`](evidence/agent-x402.json).

The API remains an x402-style demo with an in-memory invoice store, not a full
x402 implementation or a production hosted service.

---

### L1 - Outdated/overclaimed documentation (Low)

**Finding.** The README and docs claimed "100% zero mock", "9/9 contract
invariants on-chain", "formal verification", "MCP 7/7", and a "non-custodial"
contract while the deployer retained a full-access key.

**Fix.** README, `docs/ARCHITECTURE.md`, `docs/SECURITY.md` and
`docs/VERIFIED_FACTS.md` were rewritten around the
implemented, tested behavior. Unverified/unsupported claims were removed. The
deployer key is deleted after the final deployment; the README states the
exact security property.

---

### L2 — Dependency and build hygiene (Low)

**Finding.** The app pinned Next.js 14.2.3 (deprecated). The vault WASM build
used an ad-hoc `npx wasm-opt`. On Windows, the GNU toolchain could not find
`libgcc_eh.a` unless WinLibs was first on `PATH`.

**Fix.** Next.js is 14.2.35. `pnpm build:contract` uses the local
`@wasm-opt/wasm` portable binary and a WinLibs-aware `cargo` wrapper.
`pnpm test` uses the same wrapper. `near-sdk` and
`near-contract-standards` are pinned to 5.29.1.

---

## Residual risks (accepted for the hackathon)

| Risk | Why it remains | Mitigation |
| :--- | :--- | :--- |
| Cross-chain settlement not executed | 1Click is mainnet-only; no mainnet funds were used | Live quote + mainnet-ready keeper; README states the boundary |
| `ReceiverPolicy::Any` trusts the spender to pick the receiver | Rotating 1Click deposit addresses cannot be fixed in an allowlist | Caps + pause/revoke; allowlist available for fixed receivers |
| Dust-deposit storage growth | `ft_on_transfer` auto-credits new (owner, token) pairs | Token allowlist; known limitation; a production version should add a storage deposit or minimum |
| Merchant server key compromise | The server signs charges | Function-Call scope + caps + revoke; the key cannot withdraw or alter Tabs |
| No external audit | Hackathon timeline | 16 Rust tests, 23 real testnet checks, documented threat model |
| Test token is not USDC | Testnet only | Explicit labels; mainnet deployment uses real USDC |
| Contract has no upgrade path | Deployer key is deleted for immutability | A bug requires a new deployment; this is a deliberate trade-off |
| Gasless relayer is sponsor-funded | The testnet demo has no paying customer yet | Per-sender gas meter + prepaid-credit plan; testnet-only, authenticated, rate-limited, isolated gas key; sender can self-submit |
| Prepaid-credit enforcement and mainnet pricing are not implemented | The hackathon build proves the meter, not a billing system | `GET /relay/usage` records actual gas; `docs/SUSTAINABILITY.md` states the limits and roadmap |
| Relayer can censor | It chooses whether to submit | The signed delegate remains valid; sender can submit directly with gas |

---

## Evidence

- Rust: `pnpm test` → 16/16 pass.
- Testnet: [`docs/evidence/testnet-e2e.json`](evidence/testnet-e2e.json) →
  23/23 pass.
- Merchant charge through the web server before locking:
  [9VqKERqd…](https://testnet.nearblocks.io/txns/9VqKERqdHEiiF2wk6bEeV1ucSdihBLYnWnxN7pTCBcWr).
- Post-lock smoke charge through the same route:
  [89EZYcFj…](https://testnet.nearblocks.io/txns/89EZYcFjJCdR4HJjp5B3dVqzqRtNUHk5aWKxL9a8VuQj).
- Fresh test wallet direct E2E on the tester wallet
  `hardjava737.testnet`: 12/12
  (`docs/evidence/tester-wallet-e2e.json`).
- Browser UI E2E with the real wallet connector: 10/10, 0 console errors
  (`docs/evidence/UI_E2E.md`); merchant tx
  [CrBs52A5…](https://testnet.nearblocks.io/txns/CrBs52A5P9pqJRf3v4KAHTUWg8bHgPyoAJJKri4uap2S).
- NEP-366 gasless charge: 12/12 (`docs/evidence/meta-tx.json`); relayer tx
  [J78NCm2F…](https://testnet.nearblocks.io/txns/J78NCm2FpxzyUcNm3gBz1egBbfMH8J3QKosaqA2ithrS);
  agent gasless tx
  [3rNjBBf2…](https://testnet.nearblocks.io/txns/3rNjBBf2G2LZ3CoiQaUgHFpMrhJbczc42nh8bgs8V6Q4).
- Web gasless checkout: 3/3 (`docs/evidence/web-gasless.json`);
  tx [GsZpgNCA…](https://testnet.nearblocks.io/txns/GsZpgNCASb3ojcuhV8nguiuyv3YAFgcC473UrBFLunjC).
- Prompt-injection containment: 4/4 (`docs/evidence/agent-attack.json`);
  rejected tx
  [2wKAwrNv…](https://testnet.nearblocks.io/txns/2wKAwrNvPRbWtZREobK6xZxB6iEyYhhaKVMLNgQB9fkx).
- Relayer gas meter: 5/5 (`docs/evidence/relayer-usage.json`); latest
  accumulated meter 7 relays / 0.4995074277429292 NEAR testnet (earlier
  controlled run: 3 relays / 0.2493960178501748 NEAR).
- Old compromised testnet account retired:
  [7TTrJmMV…](https://testnet.nearblocks.io/txns/7TTrJmMVpRwbNkuKLh3BjoV7dHGnihhC3PfxNk3raYCt).
- Scoped merchant key and agent key: visible in
  `view_access_key_list` on `tab-merchant.testnet` and `tab-agent.testnet`.
- Final vault lock (deployer key deletion):
  [78H3E9QC…](https://testnet.nearblocks.io/txns/78H3E9QCqRTs6CXvjXwNYerYVRw8aWgua87rNRwZmJX).
  `view_access_key_list` on `tab-vault.testnet` returns **0 keys**.
