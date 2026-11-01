# SUSTAINABILITY.md — who pays for TabWrit's gas?

TabWrit has no token, no custody and no fee inside the vault. This document
explains the revenue model, why the contract cannot take a fee, and what is
already measured in the testnet build.

---

## 1. The constraint: the vault cannot take a fee

The vault is immutable and non-custodial. On a successful charge it transfers
the **exact** charged amount from the owner's ledger to the receiver. There is
no fee hook, no admin withdrawal and no upgrade path. The deployer key was
deleted after the final testnet deployment (`tab-vault.testnet` has 0 access
keys).

A NEP-366 delegate signed by a Function-Call key may contain **one**
`FunctionCall` action. It cannot also contain a token transfer to the relayer.
A FullAccess key could include a second action, but the relayer deliberately
refuses FullAccess delegates.

Therefore this model is **not possible** with the current contract:

> "Deduct $0.02 from every 10 USDC charge inside the vault."

That would require a fee function in the contract, an admin path, or a second
transfer in the delegate. All three conflict with the security model. The
sustainable model has to live **outside** the vault.

---

## 2. The model: merchant SaaS + prepaid relayer gas credits

| Revenue stream | Who pays | What they get |
| :--- | :--- | :--- |
| Merchant SaaS | Merchant / subscription business | Invoicing, checkout, webhook delivery, reconciliation, Tab dashboard |
| Prepaid relayer gas credits | Merchant or agent platform | Gasless NEP-366 charges without holding NEAR; usage metered per sender |
| Agent platform integration | AI agent platform / framework | MCP + relayer integration, policy templates, support |

The x402-style paid API is a reference merchant integration. The API provider
receives the tUSDC payment directly; TabWrit does not take a cut of that
payment. The SaaS opportunity is the billing, checkout and reconciliation
layer around such APIs, plus the relayer credits, not a fee inside the vault.

The keeper already exposes an authenticated gas meter:

```text
GET /relay/usage
Authorization: Bearer <RELAYER_API_KEY>
```

It reports, per sender:

- number of successful relays,
- actual NEAR gas paid by the relayer (the relayer account's balance delta),
- last transaction hash and timestamp.

`pnpm test:relayer-usage` verifies the endpoint and the recorded gas. The
usage file is gitignored; it contains public account IDs and hashes, never
keys.

A production deployment compares this meter with a prepaid credit balance
before accepting the next delegate. When the credit is exhausted, the relayer
returns a payment-required response instead of sponsoring more gas. The
contract remains unchanged and never holds user funds.

---

## 3. Measured testnet cost (not a mainnet price)

Latest accumulated meter (read on 2026-10-31):

| Sender | Relays | Metered NEAR gas |
| :--- | ---: | ---: |
| `tab-merchant.testnet` | 3 | 0.1981112866932904 |
| `tab-agent.testnet` | 4 | 0.3013961410496388 |
| **Total** | **7** | **0.4995074277429292** |

The average is about **0.071 NEAR per relay** on this testnet environment.
The earlier controlled three-relay run measured 0.2493960178501748 NEAR; the
meter is cumulative across runs, so the absolute total grows as tests are
re-run.
This is a stress-test number, not a mainnet price. Mainnet gas price, receipt
refunds and 1Click storage costs must be measured on mainnet before setting a
price. A production merchant SaaS price must cover the measured gas plus
margin; it cannot be assumed from testnet.

The important point is not the exact number. It is that the relayer's cost is
**measured per sender**, so a prepaid credit model can be enforced without
guessing.

The meter uses the relayer account's balance delta. It assumes a dedicated
relayer account and low concurrency. A production keeper should serialize
relays or attribute the fee from each transaction receipt before enforcing
credits; concurrent relays on a shared relayer account would blur the
per-sender delta.

---

## 4. What TabWrit does not do

- **No speculative token.** The protocol does not need one; adding one would
  not improve the product and would weaken the non-custodial story.
- **No fee inside the vault.** The contract transfers the exact amount. The
  owner can withdraw unspent funds at any time.
- **No solver spread.** TabWrit uses the external 1Click service for cross-chain
  settlement. It does not operate a solver and does not claim solver revenue.
- **No custody.** The contract holds tokens; the team does not.
- **No mainnet revenue claim.** The mainnet 1Click settlement is implemented
  but not executed in this submission. All revenue figures here are a
  testnet-informed plan, not realized revenue.

---

## 5. Why this fits the hackathon

The official judging guidance lists **technical implementation, design,
impact, originality and sustainability**. This model answers the
sustainability question without weakening the other four:

- **Technical:** the meter is a real keeper endpoint, tested with real relays.
- **Design:** the merchant sees a simple invoice/checkout flow; gas is
  abstracted away.
- **Impact:** merchants and agent platforms can use USDC rails without
  managing NEAR gas per charge.
- **Originality:** the contract stays immutable; sustainability is metered
  off-chain rather than hidden in a fee function.
- **Sustainability:** merchant SaaS + prepaid gas credits is a standard
  infrastructure model; no token, no custody, no solver spread.

---

## 6. Roadmap and risks

**Roadmap**

1. Testnet pilot: current contract, merchant checkout, NEP-366 relayer, gas
   meter.
2. Hosted merchant SaaS: invoices, webhooks, reconciliation, usage dashboard.
3. Mainnet USDC deployment and a measured 1Click settlement.
4. Prepaid credit enforcement in the keeper (usage vs credit before relay).
5. Independent security audit before meaningful TVL.

**Risks**

- Merchants may prefer a flat SaaS fee over prepaid gas credits; both can
  coexist.
- Gas price volatility on mainnet; the credit buffer must be measured, not
  guessed.
- 1Click fees and solver behavior are external; they are not TabWrit revenue.
- Relayer liveness and censorship: the signed delegate remains valid and can
  be submitted directly by the sender.
- Regulatory treatment of merchant settlement and agent payments is outside
  the contract.

---

## 7. Honest verdict

This is a credible infrastructure business model for a hackathon prototype,
not a proven company. The testnet meter and the hosted merchant flow are real;
mainnet pricing, demand and audit are not. The model is deliberately
conservative: no token, no custody, no hidden fee, no solver spread.
