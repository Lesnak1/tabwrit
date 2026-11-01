# SECURITY.md — TabWrit threat model, invariants and trust boundaries

This document describes the security properties of the TabWrit protocol as
implemented in `contracts/tab-vault`, the testnet deployment and the optional
off-chain services. It is intentionally conservative: anything the contract
cannot verify is listed as a trust boundary, not as a guarantee.

Audit findings and their fixes are in [`AUDIT.md`](AUDIT.md).

---

## 1. Assets and actors

| Asset | Custody |
| :--- | :--- |
| NEP-141 tokens in the vault | The `TabVault` contract holds the tokens; each owner has a withdrawable ledger balance. |
| Owner authority | The user's NEAR wallet. The owner key never reaches a server. |
| Spender authority | A Function-Call Access Key on the merchant/agent account, scoped to `<vault>::charge`. |
| Relayer gas | `tab-relayer.testnet` holds a FullAccess key on its own account only. It pays gas for NEP-366 delegates and never holds an owner or merchant key. |
| Contract code | Immutable after the final deployment: the deployer's full-access key is deleted. |
| 1Click settlement | Mainnet-only, off-chain quote plus an on-chain NEP-141 deposit. |

Actors:

- **Owner** — deposits, creates Tabs, pauses/resumes/revokes, withdraws.
- **Spender** — a merchant or AI agent; calls `charge` with the scoped key.
- **Merchant backend / keeper** — obtains 1Click quotes, registers storage,
  calls `charge`, submits the deposit hash, polls settlement status.
- **Relayer** — a gas-only account that submits a user-signed NEP-366
  delegate. It cannot change the signed call.
- **Attacker** — a compromised spender key, a prompt-injected agent, a
  malicious merchant, a replayed transaction, a storage griefer, a compromised
  keeper, or a malicious delegate submitted to the relayer.

---

## 2. Invariants enforced by the contract

Let `B` be the owner's ledger balance for a token and `C` a Tab.

1. **Cap safety.** For every successful charge `x`:
   `x ≤ per_charge_cap`, `spent_in_period + x ≤ per_period_cap`, and
   `spent_total + x ≤ total_cap`.
2. **Balance safety.** `x ≤ B`; the ledger is debited before the token call.
3. **Status safety.** A charge cannot succeed if `C.status != Active`.
4. **Time safety.** A charge cannot succeed if
   `block_timestamp ≥ C.expires_at_ns`.
5. **Spender authentication.** `predecessor_account_id == C.spender`;
   otherwise the transaction panics before any state change.
6. **Receiver policy.** If `C.receiver_policy == Allowlist`, the receiver must
   be in the list. `Any` is a deliberate cap-only policy.
7. **Nonce safety.** `charge` requires `nonce == C.next_nonce`; the nonce is
   consumed before the token call and is never reused for a settled or
   reserved charge.
8. **Rollback symmetry.** If the NEP-141 transfer fails, the amount is added
   back to the ledger and subtracted from the current counters; a later
   in-flight charge's accounting is preserved. `next_nonce` is rewound only
   when the failed charge was the latest reservation.
9. **Conservation.** The sum of all ledger balances equals the total token
   amount deposited minus the amount successfully transferred out (charges +
   withdrawals), subject to tokens sent directly to the vault outside
   `ft_transfer_call` (which are not credited).
10. **No admin withdrawal.** There is no deployer-only withdrawal, pause or
    parameter-change method. The deployer's key is removed after deployment.
11. **Relayer scope.** The NEP-366 relayer only submits a single `charge`
    FunctionCall to the configured vault, with zero deposit, signed by an
    Ed25519 Function-Call key scoped to `<vault>::charge`. A FullAccess key,
    another method, another receiver, a non-zero deposit, an expired block
    window, a stale nonce or an invalid signature is rejected before the
    relayer spends gas.
12. **Prompt-injection safety.** An allowlist violation is rejected before the
    nonce is consumed and before any ledger or token movement. The rejection
    is recorded as `charge_rejected` with `RECEIVER_NOT_ALLOWED`; the agent can
    retry a legitimate charge with the same nonce.

13. **x402 invoice binding.** A `tab_pay_and_fetch` payment is bound to an
    HTTP 402 invoice. The API returns data only after it verifies a
    `charge_executed` event emitted by the vault itself, with the expected
    Tab, payer, receiver, asset, amount and invoice reference. A receipt or
    invoice can be consumed once.

The Rust tests exercise invariants 1–9, including the interleaved-callback
case. The 23-check testnet run exercises the same rules with real
transactions. `pnpm test:meta` exercises invariant 11, `pnpm
test:agent-attack` exercises invariant 12, and `pnpm test:x402` exercises
invariant 13 on testnet.

---

## 3. Key hierarchy and blast radius

| Key | Scope | If compromised |
| :--- | :--- | :--- |
| Owner wallet key | Full account | Full wallet compromise. TabWrit cannot protect the owner's wallet; the owner should use a hardware wallet. |
| Merchant charge key | Function-Call on `tab-vault.testnet`, method `charge` | Can charge Tabs that name the merchant as spender, up to their caps, until the owner revokes. Cannot withdraw, pause, revoke, create Tabs, attach NEAR or call another contract. |
| Agent charge key | Function-Call on `tab-vault.testnet`, method `charge` | Same as above for Tabs that name the agent as spender. |
| Storage registrar (optional) | Full access on a separate low-balance account | Can spend the registrar's NEAR and register storage; cannot touch the vault or owner balances. |
| NEP-366 relayer | Full access on `tab-relayer.testnet` only | Can spend the relayer's gas balance and censor (not submit) delegates. It cannot alter a signed delegate or touch a vault, owner balance or merchant key. The keeper meters the actual gas per sender for prepaid credits. |
| Vault deployer | Full access on the vault account | **Removed after the final deployment.** Before removal it could replace the code; that is why it is deleted. |
| Test token owner | Full access on `tab-usdc.testnet` | Testnet-only; can mint/upgrade the test token. It has no monetary value. Do not treat it as a production asset. |

NEAR protocol rule: a Function-Call Access Key cannot attach a deposit. The
vault's `charge` requires `attached_deposit == 0` from the caller and attaches
1 yocto itself for `ft_transfer`. This is why a leaked spender key cannot
sweep NEAR or move tokens outside the contract's rules.

---

## 4. Threat model

| Adversary | Capability | Goal | Defense |
| :--- | :--- | :--- | :--- |
| **Compromised agent** | Controls the agent process and its scoped key; can be prompt-injected | Drain the vault or redirect funds | Contract caps, expiry, allowlist, pause/revoke; the key cannot withdraw or change the Tab. |
| **Malicious merchant** | Has a scoped key and can choose the receiver under `Any` | Charge more than agreed or send funds elsewhere | Per-charge/period/lifetime caps; owner can revoke; use an allowlist for fixed receivers. |
| **Replay attacker** | Repeats a signed charge transaction | Double-charge | Monotonic nonce; a consumed nonce panics with `ERR_NONCE_MISMATCH`. |
| **Storage griefer** | Creates many Tabs or dust balance entries | Exhaust the contract's storage balance | `create_tab` requires 0.01 NEAR, labels ≤64 bytes, allowlists ≤20, 100 Tabs/owner. Dust-deposit storage remains a known limitation. |
| **Malicious token** | An allowlisted token contract misbehaves | Fake deposits, reentrancy, freeze funds | The allowlist is curated at init; the token is trusted. The callback rolls back failed transfers. A malicious token can still break its own transfers; this is inherited risk. |
| **Quote manipulator** | Controls the merchant backend or the 1Click response | Send the vault's tokens to an attacker-controlled deposit address | The contract cannot verify 1Click deposit ownership; `Any` is cap-only. The owner must trust the merchant inside the cap, or use `Allowlist` and forgo 1Click. |
| **Keeper compromise** | Controls the merchant backend | Charge Tabs that authorize the merchant | Scoped key + caps + revoke; the keeper cannot withdraw owner funds. |
| **Malicious paid API** | Returns a 402 challenge with a hostile `payTo`, a high amount or a fake invoice | Redirect or overcharge an agent payment | Client preflight checks the Tab, token, caps, receiver allowlist and vault balance; the contract re-checks all of them and remains the authority. The client refuses plain HTTP for remote hosts and defaults to a localhost allowlist. |
| **Receipt or event forger** | Presents another transaction, a look-alike event or a replayed receipt to a paid API | Get paid data without a valid payment | The API requires a `charge_executed` event emitted by the vault, binds Tab/payer/receiver/asset/amount/reference to the invoice, and consumes the invoice and receipt once. Replay, wrong payer and wrong amount are rejected. |
| **Owner key compromise** | Full owner access | Withdraw everything | Outside Tab's scope; use a hardware wallet. Tab's non-custodial design at least means the attacker only gets what the owner's wallet controls. |
| **Malicious delegate** | Can submit arbitrary JSON to `/relay/delegate` | Make the relayer pay for a transfer, a different contract call or a FullAccess-key action | The relayer decodes and validates one `charge` call to the vault, zero deposit, max 100 Tgas, a bounded block window, a fresh access-key nonce, an Ed25519 signature and a FunctionCall key scoped to `charge`. FullAccess keys are refused. |
| **Relayer gas griefing** | Repeated invalid or policy-rejected delegates | Drain the relayer's gas balance | `/relay/delegate` requires `RELAYER_API_KEY`, is rate-limited per sender, caps gas and block window, and preflights the Tab/spender/token. Policy rejections still cost gas; the testnet balance is small and isolated. |
| **Relayer censorship** | Refuses to submit a valid delegate | Block a merchant payment | The sender can submit the same signed delegate directly with its own gas. Tab does not depend on this relayer for correctness. |

---

## 5. Callback and concurrency reasoning

`charge` is a two-receipt operation:

1. The `charge` call validates the rule, consumes the nonce, increments the
   counters, debits the ledger, and returns a promise chain
   `ft_transfer(...).then(on_charge_transfer_callback(...))`.
2. The callback runs later. It either confirms success (event + global stats)
   or rolls back.

Because another charge can be reserved between (1) and (2), rollback cannot
restore a pre-charge snapshot. Tab subtracts from the current counters. If the
period rolled over, it does not subtract from the new period's
`spent_in_period`. `next_nonce` is only rewound when the failed charge is the
latest reservation; otherwise a later charge would be replayable.

This is tested by `test_interleaved_charge_rollback_preserves_later_charge`
and by testnet `S10a/S10b`.

Residual risk: if the callback never executes (e.g. the receipt runs out of
gas or the network fails), the reservation remains. The charge consumes the
nonce and the ledger stays debited. The callback is given 30 Tgas and the
total charge call 100 Tgas; standard NEP-141 transfers fit. A production
version could add an owner-only reconciliation path or a pending-charge map.
This is listed as a limitation.

---

## 6. Trust boundaries

1. **1Click deposit ownership is not proven on-chain.** A 1Click deposit
   address is a fresh implicit account per quote. The contract can enforce
   caps and a fixed allowlist, but it cannot know that the address belongs to
   the invoice's merchant. `ReceiverPolicy::Any` is therefore cap-only. This
   is the central trade-off of the cross-chain path.
2. **The merchant backend is trusted inside the Tab.** It chooses the
   invoice amount (bounded by caps) and the destination. The owner's defense
   is the cap, pause and revoke.
3. **The token allowlist is trusted.** A malicious allowlisted token can
   misbehave. Only vetted NEP-141 contracts should be allowlisted; the test
   token is explicitly testnet-only.
4. **The web server holds the merchant's scoped key.** It cannot withdraw or
   alter Tabs, but it can charge within the caps. Keep the server patched and
   the key scoped.
5. **1Click is an external mainnet service.** A quote is not a settlement.
   The destination chain transaction and the solver's behavior are outside
   the contract. The keeper polls 1Click status and emits
   `tab.settlement.succeeded` only after `SUCCESS`.
6. **The NEP-366 relayer sees the signed payment intent.** It learns the Tab
   ID, amount and receiver of every delegate it submits. It cannot change them
   because the signature binds the exact Borsh-encoded action. It can censor by
   not submitting; the sender can always submit the same delegate directly
   with gas. The relayer is a convenience, not a trust anchor.
7. **Gas accounting is off-chain.** The contract cannot take a fee: the vault
   transfers the exact charged amount, and a Function-Call delegate may contain
   only one `charge` action. The keeper records the relayer's actual NEAR
   balance delta per sender and exposes it at `GET /relay/usage`. The testnet
   deployment does not enforce a prepaid credit balance; a production
   deployment must add that check. The meter is not a contract guarantee.
8. **The x402-style paid API is a demo resource.** It verifies payments, but it
   is not a full x402 implementation and its invoice store is in-memory. A
   production paid API needs durable invoice storage, TLS, authentication,
   rate limits and a proper x402 implementation. The payment verification
   itself is on-chain and does not depend on the demo server.

---

## 7. Known limitations

- **Testnet token.** `tab-usdc.testnet` is a test NEP-141 token with a public
  faucet. It is not USDC and has no value.
- **No executed mainnet settlement.** The 1Click path is implemented and
  quote-tested, but this submission does not spend mainnet funds. A real
  settlement needs a funded mainnet vault and USDC.
- **Storage.** `create_tab` costs 0.01 NEAR and is not refunded on revoke.
  The vault pays for new balance entries; dust-deposit spam is bounded by the
  token allowlist but not eliminated.
- **No upgrade path.** The deployer key was deleted after the final
  deployment. A bug requires a new deployment and a migration.
- **No external audit.** The evidence is the 16 Rust tests, the 23 real
  testnet checks and this review. A production deployment with meaningful TVL
  should hire an independent auditor.
- **Optional keeper.** The keeper's 1Click settlement is mainnet-only and
  needs a storage registrar. It is not on the testnet critical path.
- **Gasless relayer is testnet-only and sponsor-funded.** `tab-relayer.testnet`
  pays gas from a testnet balance. The keeper meters actual gas per sender, but
  prepaid-credit enforcement and mainnet pricing are not implemented. The
  delegate remains valid and self-submittable without the relayer.
- **x402-style demo, not full x402.** The paid API uses a `tabwrit` scheme, an
  in-memory invoice store and a localhost demo server. It verifies the real
  on-chain event, but it is not a complete x402 implementation and is not a
  hosted production service.
- **No contract fee.** The vault transfers the exact charged amount and has no
  fee hook. The business model is merchant SaaS plus prepaid relayer gas
  credits; it does not take a cut of user funds. See
  [`SUSTAINABILITY.md`](SUSTAINABILITY.md).
- **Gasless does not remove the scoped key.** The merchant or agent still holds
  a Function-Call key. The relayer removes the need for that account to hold
  NEAR, not the need to protect the key. Caps, expiry, allowlist, pause and
  revoke remain the enforcement layer.
- **Webhook SDK.** The webhook verifier is unit-tested HMAC, not a complete
  merchant reconciliation service. Merchants should persist invoice IDs.
- **Keeper webhook URL.** The optional keeper POSTs to a caller-supplied
  `webhookUrl`. The `/charge` and `/receipts` endpoints require
  `KEEPER_API_KEY`, but a compromised merchant key could use the keeper for
  SSRF against internal endpoints. A production keeper should allowlist
  merchant webhook hosts and egress-filter its network.

---

## 8. Operational guidance

- Use a dedicated merchant/agent account with a Function-Call key scoped to
  `charge`; never reuse an owner key.
- Keep `MERCHANT_CHARGE_PRIVATE_KEY` server-side only. Rotate it by adding a
  new key and deleting the old one.
- Resolve the Tab's `next_nonce` immediately before charging. Do not cache
  nonces across requests.
- Revoke a Tab immediately if a merchant/agent key is suspected compromised.
- Withdraw unspent funds if the vault or token is deprecated.
- For fixed receivers (payroll, API providers), use `Allowlist`; for 1Click,
  use `Any` and keep caps small.
- Verify the final deployment has **0 access keys** on the vault account
  after locking it.

---

## 9. Evidence

- Rust: `pnpm test` → 16/16.
- Testnet: [`docs/evidence/testnet-e2e.json`](evidence/testnet-e2e.json) →
  23/23.
- Scoped keys: `tab-merchant.testnet` and `tab-agent.testnet` each have a
  FunctionCall key on `tab-vault.testnet` with `charge` only.
- Live MCP agent charge: Tab #17, 1 tUSDC from the agent to the merchant:
  [5CeLAGec…](https://testnet.nearblocks.io/txns/5CeLAGecBQdqqtdXKEEhTzYTEUDuD6tfBuHL7PU9LN1n).
- Old compromised account retired:
  [7TTrJmMV…](https://testnet.nearblocks.io/txns/7TTrJmMVpRwbNkuKLh3BjoV7dHGnihhC3PfxNk3raYCt).
- Final vault lock:
  [78H3E9QC…](https://testnet.nearblocks.io/txns/78H3E9QCqRTs6CXvjXwNYerYVRw8aWgua87rNRwZmJX).
  `view_access_key_list` on `tab-vault.testnet` returns **0 keys**.
