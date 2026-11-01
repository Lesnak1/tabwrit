# ARCHITECTURE.md — TabWrit protocol and system design

TabWrit is a spending-Tab layer on NEAR. It separates custody from spending
authorization: the owner keeps a withdrawable vault balance, while each
merchant or agent receives a capped, expiring, revocable pull authorization.

This document describes the implemented system, not a future roadmap.

---

## 1. Components

```text
Owner wallet
    │  wallet-signed: ft_transfer_call, create_tab, pause/resume/revoke, withdraw
    ▼
NEP-141 token ── ft_transfer_call ──► TabVault
                                        │  ledger + Tab rules
                                        │  charge (scoped spender key)
                                        ▼
                                   ft_transfer
                                        │
                     ┌──────────────────┴──────────────────┐
                     ▼                                     ▼
              Merchant NEAR account               1Click deposit address
              (testnet demo)                      (mainnet settlement)
                                                         │
                                                         ▼
                                                NEAR Intents solver
                                                         │
                                                         ▼
                                                Destination asset/chain
```

Off-chain:

- `apps/web` — Next.js app: wallet connector, vault dashboard, merchant
  checkout, real evidence lab, docs.
- `services/keeper` — optional mainnet merchant backend: 1Click quotes,
  storage registration, charge, status polling, signed webhooks.
- `packages/tab-mcp` — MCP server for agents: read tools + scoped charge.
- `packages/tab-sdk` — HMAC-SHA256 webhook signature verifier.
- `scripts/` — testnet bootstrap, deployment, Attack Lab, evidence printer.

---

## 2. Contract state

```rust
pub struct TabVault {
    allowed_tokens: LookupSet<AccountId>,
    token_list: Vec<AccountId>,
    balances: LookupMap<(AccountId, AccountId), u128>, // (owner, token) -> amount
    tabs: LookupMap<u64, Tab>,
    owner_tabs: LookupMap<AccountId, Vector<u64>>,
    spender_tabs: LookupMap<AccountId, Vector<u64>>,
    next_tab_id: u64,
    total_charges: u64,
    token_volume: LookupMap<AccountId, u128>,
}

pub struct Tab {
    id: u64,
    owner: AccountId,
    spender: AccountId,
    token: AccountId,
    per_charge_cap: U128,
    per_period_cap: U128,
    total_cap: U128,
    period_secs: u64,
    start_ns: u64,
    expires_at_ns: u64,
    receiver_policy: ReceiverPolicy,
    status: TabStatus,
    spent_total: U128,
    period_index: u64,
    spent_in_period: U128,
    charge_count: u64,
    next_nonce: u64,
    label: String,
}

pub enum ReceiverPolicy {
    Any,                       // required for rotating 1Click deposit addresses
    Allowlist(Vec<AccountId>), // fixed NEAR receivers only
}

pub enum TabStatus { Active, Paused, Revoked }
```

Storage:

- The contract account holds the NEP-141 tokens and pays for its own state.
- `create_tab` requires 0.01 NEAR (`MIN_TAB_STORAGE`) to bound storage
  griefing. The deposit stays in the contract; revoking does not refund it.
- The vault must be registered on each allowlisted token (NEP-145) before it
  can receive deposits. The deployment script does this.

---

## 3. Deposit flow

```text
owner -> token.ft_transfer_call(vault, amount, msg="")
token -> vault.ft_on_transfer(sender_id=owner, amount, msg)
vault -> token.ft_resolve_transfer(...): unused = 0
```

- `ft_on_transfer` accepts only allowlisted tokens. Unknown tokens are
  returned in full.
- The vault credits `sender_id` (the original owner), not the token contract.
- `amount` must be > 0; the balance add is checked.
- Emits `EVENT_JSON:{"standard":"tab","version":"1.0.0","event":"deposit",...}`.

---

## 4. Create Tab

```text
owner -> vault.create_tab(
    spender, token,
    per_charge_cap, per_period_cap, total_cap,
    period_secs, expires_at_ns,
    receiver_policy, label
)
```

Checks:

- `attached_deposit >= 0.01 NEAR`
- token is allowlisted
- `label.len() <= 64`
- `0 < per_charge <= per_period <= total`
- `period_secs > 0`
- `expires_at_ns > block_timestamp`
- allowlist non-empty and `<= 20` if used
- owner has `< 100` Tabs

The Tab starts at `period_index = 0`, `spent_* = 0`, `next_nonce = 0`, status
`Active`. The owner and spender indexes are updated; `tab_created` is emitted.

Owner actions:

- `pause_tab` / `resume_tab` — Active ↔ Paused; owner only.
- `revoke_tab` — terminal; owner only.
- `withdraw(token, amount)` — owner only; effects before interaction, with a
  private callback restoring the balance if the token transfer fails.

---

## 5. Charge flow

```text
spender -> vault.charge(tab_id, amount, receiver_id, reference, nonce)
```

Validation order:

1. caller == `tab.spender` (panic `ERR_CALLER_NOT_SPENDER`)
2. `reference.len() <= 128`
3. `nonce == tab.next_nonce` (panic `ERR_NONCE_MISMATCH`)
4. `amount > 0`
5. status == Active → else `Rejected(TAB_NOT_ACTIVE)`
6. `block_timestamp < expires_at_ns` → else `TAB_EXPIRED`
7. `amount <= per_charge_cap` → else `PER_CHARGE_CAP`
8. allowlist contains `receiver_id` (if policy) → else `RECEIVER_NOT_ALLOWED`
9. period rollover + `spent_in_period + amount <= per_period_cap`
   → else `PERIOD_CAP`
10. `spent_total + amount <= total_cap` → else `TOTAL_CAP`
11. `owner_balance >= amount` → else `INSUFFICIENT_BALANCE`

On success, before the cross-contract call:

- `next_nonce += 1`
- `period_index = current_period_index`
- `spent_in_period += amount`
- `spent_total += amount`
- `charge_count += 1`
- ledger balance -= amount
- `ft_transfer(receiver_id, amount, "Tab charge: ref=...")` with 1 yocto,
  30 Tgas
- `.then(on_charge_transfer_callback(...))` with 30 Tgas

The outer `charge` returns a promise; a policy rejection returns a plain
`ChargeExecutionResult::Rejected` and does not consume the nonce. This lets
the spender correct the request.

### Callback

`on_charge_transfer_callback` is `#[private]` (only the vault can call it).

- Success: emit `charge_executed`, increment `total_charges` and
  `token_volume[token]`.
- Failure: subtract the amount from the **current** counters, subtract from
  `spent_in_period` only if the failed charge's period is still current,
  decrement `charge_count`, rewind `next_nonce` only if this was the latest
  reservation, restore the ledger, emit `charge_failed`.

The snapshot approach was removed because it could erase a later in-flight
charge. See `docs/AUDIT.md` C2 and
`test_interleaved_charge_rollback_preserves_later_charge`.

### NEP-297 events

All events are `EVENT_JSON:` envelopes with `standard: "tab"` and
`version: "1.0.0"`:

- `deposit`
- `tab_created`
- `tab_status_changed`
- `charge_executed` (includes nonce)
- `charge_rejected` (includes reason code, owner, spender, token)
- `charge_failed`
- `withdraw`

### NEP-366 gasless charge

A merchant or agent can charge without holding NEAR:

1. The sender builds a `DelegateAction` with exactly one `FunctionCall`:
   `vault.charge(tab_id, amount, receiver_id, reference, nonce)`, gas 100 Tgas,
   deposit 0.
2. The sender signs `sha256(encodeDelegateAction(delegate))` with its Ed25519
   Function-Call key scoped to `<vault>::charge`.
3. The sender posts the JSON delegate to the keeper's authenticated
   `/relay/delegate` endpoint.
4. The keeper validates: receiver == vault, one action, method == `charge`,
   deposit == 0, gas <= 100 Tgas, block window <= 200, current access-key
   nonce, Ed25519 signature, FunctionCall permission scoped to `charge`, Tab
   exists, Tab spender == sender, token matches, Tab nonce matches.
5. The keeper submits a transaction to the sender account with a
   `SignedDelegate` action. The relayer signs the outer transaction and pays
   gas.
6. The runtime executes the delegate as the sender, so `predecessor_id` in
   `charge` is the merchant/agent. Caps, allowlist and nonce are enforced
   exactly as in a normal charge.

The relayer cannot change the call: the signature covers the full Borsh
delegate, including the receiver, method, args, nonce and block height. A
FullAccess-key delegate is refused, so the relayer cannot be tricked into
relaying a NEAR transfer or an owner action. The agent attack test signs a
redirect to `tab-attacker.testnet`; the relayer submits it, and the contract
rejects it with `RECEIVER_NOT_ALLOWED`. The rejection is on-chain evidence,
not a client-side guard.

---

## 6. Period semantics

- `start_ns` is set at Tab creation.
- `current_period_index = (now - start_ns) / (period_secs * 1e9)`.
- If the index advances, the new period starts with `spent_in_period = 0`;
  the lifetime `spent_total` is unchanged.
- Pausing does not stop the period clock. A Tab paused for a long time still
  advances periods; the owner should revoke if the schedule is no longer
  wanted.
- The `get_remaining` view returns 0/0 for paused, revoked or expired Tabs.

---

## 7. Key hierarchy

| Key | Holder | Scope |
| :--- | :--- | :--- |
| Owner | User wallet | Full account; signs deposits, create/pause/revoke/withdraw |
| Merchant charge | Merchant server | FunctionCall `tab-vault.testnet::charge` only, no deposit |
| Agent charge | MCP/agent process | FunctionCall `tab-vault.testnet::charge` only, no deposit |
| Storage registrar | Keeper (optional) | Full access on a separate low-balance account; NEP-145 `storage_deposit` |
| NEP-366 relayer | Keeper | Full access on `tab-relayer.testnet` only; pays gas for validated `charge` delegates; keeper meters actual gas per sender |
| Deployer | Deployment operator | Full access; deleted after the final deployment |

NEAR protocol rule: Function-Call keys cannot attach a deposit. The vault
requires 0 deposit from the spender and attaches 1 yocto itself for
`ft_transfer`. A leaked spender key cannot withdraw NEAR or call another
contract.

---

## 8. 1Click settlement (mainnet)

1. Merchant backend requests `POST /v0/quote`:
   - `dry: false` (mainnet only)
   - `swapType: EXACT_OUTPUT`
   - `originAsset: nep141:<mainnet token contract>`
   - `destinationAsset` from the live token list
   - `amount` = destination base units
   - `refundTo` = a real mainnet NEAR account
   - `recipient` = destination-chain address
2. 1Click returns `amountIn`, `minAmountIn`, `depositAddress`, `deadline`,
   `signature`, `correlationId`.
3. The keeper verifies the token is listed, the Tab is `Any` (an allowlist
   cannot contain a rotating deposit address), the quote input is within the
   Tab's caps, and the deposit address is registered on the origin token
   (NEP-145 `storage_deposit` from the storage registrar).
4. The keeper calls `charge(tab_id, amountIn, depositAddress, reference,
   nonce)` with the merchant's scoped key.
5. On success, the vault sends `amountIn` to the deposit address. The keeper
   calls `POST /v0/deposit/submit` and polls `/v0/status`.
6. `tab.charge.deposited` webhook means the NEAR leg was sent.
   `tab.settlement.succeeded` is emitted only when 1Click reports `SUCCESS`.

The testnet app does not execute steps 3–6. It shows a live `dry: true`
quote and performs a real on-chain tUSDC charge to the merchant account.

Trust boundary: the contract cannot prove a 1Click deposit address belongs to
a merchant. `Any` is cap-only; `Allowlist` is available for fixed receivers.

---

## 9. Web application

```text
app/layout.tsx        nav + wallet provider + footer
app/page.tsx          landing: live vault stats, product explanation
app/app/page.tsx      vault: connect, faucet, deposit, create, pause/revoke, withdraw
app/merchant/page.tsx merchant checkout + live 1Click quote preview
app/lab/page.tsx      committed 23/23 + gasless + agent + x402 evidence
app/docs/page.tsx     architecture, API, security, limitations
lib/wallet.tsx        HOT Labs WalletSelector/UI; wallet-signed calls
lib/rpc.ts            read-only RPC views and formatting
lib/config.ts         NEXT_PUBLIC_* configuration
lib/server-near.ts    server-only merchant charge with scoped key
lib/server-meta-tx.ts NEP-366 delegate signing + keeper relay
api/merchant          GET config; POST direct charge
api/merchant/charge-gasless  POST signed delegate to the relayer
api/quote             live 1Click dry quote
```

The owner's browser signs transactions with the wallet connector. The browser
never sees a private key. The server-only merchant route holds the merchant's
Function-Call key; it is not a wallet and cannot withdraw.

The UI has no sample balances, no default cap numbers and no fallback Tabs.
When a view fails, it shows an error or empty state.

---

## 10. Keeper

The optional keeper is a Node/Express service:

- `GET /health` — network/vault/token/merchant (no secrets).
- `GET /tokens` — live 1Click token list.
- `POST /quote` — `dry: true` quote, no deposit.
- `POST /charge` — authenticated with `KEEPER_API_KEY`, **mainnet only**.
- `GET /receipts` — authenticated with `KEEPER_API_KEY`; merchant receipts.
- `GET /relay/status` — public relayer account/balance, no key material.
- `GET /relay/usage` — authenticated with `RELAYER_API_KEY`; actual NEAR gas
  per sender, used for prepaid credits.
- `POST /relay/delegate` — authenticated with `RELAYER_API_KEY`; validates
  and submits a NEP-366 `charge` delegate. The relayer pays gas.

It uses a scoped merchant key for `charge` and a separate optional storage
registrar for NEP-145. The testnet deployment returns
`501 MAINNET_REQUIRED`; it does not pretend to settle on testnet.

---

## 11. MCP server

Six tools:

1. `tab_get_details` — on-chain Tab state.
2. `tab_get_vault_balance` — owner ledger balance.
3. `tab_get_remaining_allowance` — period/lifetime remaining.
4. `tab_list_tabs` — owner/spender indexes.
5. `tab_charge_invoice` — fetches `next_nonce`, signs with the agent's scoped
   key, calls `charge`.
6. `tab_pay_and_fetch` — x402-style paid fetch: reads an HTTP 402 challenge,
   binds it to an invoice, preflights the Tab, charges, and retries with the
   on-chain receipt.

Owner tools (create/revoke) are intentionally absent. An agent cannot change
its own rule. `packages/tab-mcp/test-mcp-charge.ts` verifies the write path
live on testnet: Tab #17, agent charge of 1 tUSDC to the merchant
([5CeLAGec…](https://testnet.nearblocks.io/txns/5CeLAGecBQdqqtdXKEEhTzYTEUDuD6tfBuHL7PU9LN1n)).

### 11.1 x402-style paid API

`scripts/x402-api.ts` is a real HTTP 402 resource with a TabWrit payment
scheme. It is **x402-style**, not a full x402 implementation:

1. An unpaid `GET` returns `402` with an `accepts[]` entry containing the
   `tabwrit` scheme, `network`, `asset`, `payTo`, `maxAmountRequired`, the
   resource URL and `extra.invoiceId` / `extra.reference`.
2. `tab_pay_and_fetch` validates the challenge, host allowlist, HTTPS (except
   localhost), resource URL, invoice ID, Tab spender, status, expiry, token,
   caps, remaining allowance, receiver policy and vault balance.
3. The MCP client charges the invoice with the agent's scoped key. The
   reference is bound to `x402:<invoiceId>`.
4. The client retries with `X-Tab-Receipt`, `X-Tab-Payer` and
   `X-Tab-Invoice`.
5. The API fetches the transaction, requires a `charge_executed` event emitted
   by the vault itself, and checks Tab, payer, receiver, asset, amount and
   invoice reference. It then consumes the invoice and the receipt atomically
   in memory and returns live testnet data.

The API is a demo server bound to `127.0.0.1`; invoices are in memory and are
not durable across restarts. The client defaults to a localhost host allowlist
and refuses plain HTTP for remote hosts. `TAB_X402_ALLOWED_HOSTS` must be set
explicitly for a hosted paid API.

The 13-check test is `scripts/test-agent-x402.ts`; evidence is
`docs/evidence/agent-x402.json`.

---

## 12. Webhook verifier

`@tab-protocol/sdk` exports `verifyTabWebhookSignature`. The dispatcher sends
`X-Tab-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` over
`<timestamp>.<rawBody>`. The verifier checks the timestamp tolerance
(default 300s) and uses `crypto.timingSafeEqual`. The unit test covers a valid
signature, tampered body, wrong secret and stale timestamp.

---

## 13. Testnet topology

| Component | Account |
| :--- | :--- |
| Vault | `tab-vault.testnet` |
| Test token | `tab-usdc.testnet` (6 decimals, public faucet, 100 tUSDC/claim) |
| Merchant/spender | `tab-merchant.testnet` (FunctionCall charge key) |
| Demo owner | `tab-demo.testnet` |
| Agent/spender | `tab-agent.testnet` (FunctionCall charge key) |
| RPC | `https://test.rpc.fastnear.com` |

The vault deployer key was deleted after the final deployment. The test token
owner key remains because it is a testnet faucet asset; it is not a
production asset.

---

## 14. Design decisions and trade-offs

- **Per-owner ledger, not per-Tab escrow.** A Tab is an authorization rule;
  funds remain withdrawable. This avoids locking funds in many escrows and
  lets the owner reuse one balance across Tabs.
- **Nonce, not a reference set.** A `u64` nonce is cheap and avoids unbounded
  storage of invoice IDs. Merchants must persist their invoice IDs on their
  side; the nonce guarantees transaction replay safety.
- **Any vs Allowlist.** `Any` is required for 1Click because the deposit
  address rotates. `Allowlist` is stronger but cannot follow a rotating
  address. This is a product-level choice, not a hidden contract detail.
- **Immutable final deployment.** No upgrade method and no deployer key after
  locking. A bug requires a new deployment. This is a deliberate security
  trade-off for a vault holding user funds.
- **No admin controls.** There is no pause-all, no fee switch and no
  deployer withdrawal. The owner's only controls are pause/revoke/withdraw
  on their own Tabs and balance.
