# VERIFIED_FACTS.md — TabWrit facts checked against live sources

All entries were re-checked on **2026-10-25** unless noted. Anything not
checked is marked **UNVERIFIED** and is not used as a product claim.

---

## 1. NEAR Function-Call Access Keys cannot attach a deposit

- **Source:** https://docs.near.org/protocol/accounts-contracts/access-keys
- **Fact:** A Function-Call Access Key is restricted to a specific contract
  and method list, and cannot attach NEAR tokens to a call.
- **Use in Tab:** spenders receive a Function-Call key scoped to
  `<vault>::charge`. `charge` requires zero attached deposit from the caller
  and the vault attaches 1 yocto itself for `ft_transfer`.
- **On-chain check:** `tab-merchant.testnet` and `tab-agent.testnet` each show
  one FullAccess key (admin) and one FunctionCall key for
  `tab-vault.testnet` with method `charge` only.

## 2. 1Click is a mainnet service

- **Source:** https://docs.near-intents.org/ and the live API at
  `https://1click.chaindefuser.com`.
- **Fact:** 1Click quotes and settlements operate on NEAR mainnet. There is
  no public testnet deployment. The API can be called with `dry: true` to get
  a live quote without a deposit address or funds.
- **Use in Tab:** the cross-chain settlement path is mainnet-only. The
  testnet demo uses a real tUSDC transfer on NEAR and labels the 1Click quote
  as a preview.

## 3. 1Click quote schema and behavior (live)

- **Source:** `POST https://1click.chaindefuser.com/v0/quote` and
  `GET /docs/v0/openapi.yaml`.
- **Required fields:** `dry`, `swapType`, `slippageTolerance`, `originAsset`,
  `depositType`, `destinationAsset`, `amount`, `refundTo`, `refundType`,
  `recipient`, `recipientType`, `deadline`.
- **`EXACT_OUTPUT` semantics:** the destination amount is fixed; slippage is
  on the input side. `amountIn` includes a buffer above `minAmountIn`; any
  excess input is refunded to `refundTo` after the swap. A deposit below
  `minAmountIn` is refunded at the deadline.
- **Live response (2026-10-24):** a 10 USDC Base invoice returned
  `amountIn: "10105377"`, `minAmountIn: "10004323"`,
  `amountOut: "10000000"`, `timeEstimate: 22`.
- **HTTP status:** a successful quote returned **201** (not 200); the client
  checks `res.ok`.
- **Dry vs live:** `dry: true` has no `depositAddress`/`deadline` in the
  quote. `dry: false` returns a 64-character hexadecimal implicit account as
  the NEAR deposit address.
- **Refund account:** a non-existent `refundTo` such as `tab-demo.near`
  returned HTTP 400 "Internal server error"; real accounts (`near.near`,
  `test.near`) returned 201. Use a real mainnet account.
- **Recipient validation:** a normal Solana wallet address worked; a Solana
  token mint address (`EPjFW...`) returned 400 for a USDC destination. The
  UI accepts any base58 string and surfaces the API error.

## 4. Live asset IDs

- **Source:** `GET https://1click.chaindefuser.com/v0/tokens` (205 tokens on
  2026-10-24).
- **NEAR USDC:** `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`
  (6 decimals, contract `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`).
- **Base USDC:** `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near`.
- **Arbitrum USDC:** `nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near`.
- **Solana USDC:** `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near`.
- **Ethereum USDC:** resolved from the live list by the quote endpoint
  (blockchain `eth`, symbol `USDC`); the exact asset ID is not hardcoded in
  the app.
- Tab resolves assets from this list rather than constructing IDs.

## 5. NEP-141 and NEP-145 storage

- **Source:** https://nomicon.io/Standards/Tokens/FungibleToken/Core and
  https://nomicon.io/Standards/StorageManagement
- **Fact:** `ft_transfer` requires the receiver to be registered on the token
  contract (NEP-145), otherwise standard implementations panic. A NEP-141
  receiver's `ft_on_transfer` returns the unused amount; 0 keeps the tokens.
- **Use in Tab:** the vault is registered on the test token. The mainnet
  keeper registers each fresh 1Click deposit address with
  `storage_deposit` before charging. The vault callback rolls back if the
  transfer fails (verified by testnet S10).

## 6. Rust / SDK versions

- **Source:** local toolchain and `Cargo.lock`.
- **Rust:** 1.99.1, target `wasm32-unknown-unknown`.
- **near-sdk / near-contract-standards:** 5.29.1.
- **Build:** `pnpm build:contract` produces an optimized `tab_vault.wasm`
  (171 KB in the 2026-10-24 build) and `nep141_token.wasm` (103 KB).
- The contract's `version()` returns `0.1.0`.

## 7. NEAR testnet RPC

- **Source:** live requests.
- `https://rpc.testnet.near.org` returned HTTP 429 and a deprecation warning
  on 2026-10-24.
- `https://test.rpc.fastnear.com` and `https://rpc.testnet.fastnear.com`
  returned HTTP 200 with `chain_id: testnet` and node version
  `2.14.0-rc.5`.
- The app and scripts use `https://test.rpc.fastnear.com`.

## 8. Wallet connector

- **Source:** installed `@hot-labs/near-connect` 0.2.15 typings and README.
- **API:** `WalletSelector` + `WalletSelectorUI`; `network: "testnet" | "mainnet"`.
- `wallet.signAndSendTransaction({ receiverId, actions })` accepts actions in
  the connector's shape:
  `{ type: "FunctionCall", params: { methodName, args, gas: string, deposit: string } }`.
- The UI is client-only; Tab imports it dynamically and sets the page ready
  before the remote manifest finishes, so a slow manifest does not block the
  app.
- The connector is not a wallet itself and does not hold keys.

## 9. NEP-366 meta transactions

- **Source:** https://github.com/near/NEPs/blob/master/neps/nep-0366.md
  (checked 2026-10-25).
- **Fact:** a `DelegateAction` can be signed by the sender and submitted by a
  relayer. The relayer pays gas. The signature is verified over
  `hash(delegate_action)`. The delegate nonce must be greater than the
  access-key nonce and `max_block_height` must be above the current height.
- **Permission rule:** for a `FunctionCall` access key, the delegate may
  contain only one `FunctionCall` action, the delegate receiver must match the
  key's `receiver_id`, and the method must be in `method_names`. A
  `FullAccess` key allows any action, so a relayer must reject FullAccess
  delegates if it only wants to sponsor charges.
- **Use in Tab:** the merchant/agent signs a single `charge` call to
  `tab-vault.testnet`; `tab-relayer.testnet` validates the scoped key and pays
  gas. The relayer refuses FullAccess keys, other methods, other receivers,
  deposits, stale nonces and expired block windows.
- **On-chain check:** `pnpm test:meta` → 12/12. The outer transaction signer is
  `tab-relayer.testnet`; the merchant and agent NEAR balances are unchanged;
  the relayer's balance decreases; the agent's prompt-injected redirect is
  rejected with `RECEIVER_NOT_ALLOWED`; replay/tampered-signature/FullAccess
  delegates are rejected. Evidence:
  `docs/evidence/meta-tx.json`.
- **Gas meter:** `GET /relay/usage` (authenticated) reports the relayer's
  actual NEAR balance delta per sender. `pnpm test:relayer-usage` → 5/5. The
  latest accumulated meter (2026-10-31) recorded 7 relays and
  0.4995074277429292 NEAR on testnet; the earlier controlled three-relay run
  was 0.2493960178501748 NEAR. This is a testnet measurement, not a mainnet
  price. Evidence: `docs/evidence/relayer-usage.json`.

## 10. Testnet deployment and evidence

- **Vault:** `tab-vault.testnet` — deployed and initialized with
  `allowed_tokens = ["tab-usdc.testnet"]`.
- **Token:** `tab-usdc.testnet` — NEP-141, name "Tab Test USDC", symbol
  `tUSDC`, 6 decimals, public `faucet()` mints 100 tUSDC.
- **Merchant:** `tab-merchant.testnet` — FullAccess admin + FunctionCall key
  on `tab-vault.testnet::charge`.
- **Agent:** `tab-agent.testnet` — FullAccess admin + FunctionCall key on
  `tab-vault.testnet::charge`.
- **Demo owner:** `tab-demo.testnet`.
- **Attack Lab:** `docs/evidence/testnet-e2e.json` — 23/23 real checks,
  generated by `pnpm testnet:e2e`.
- **Web merchant charge:** a real tUSDC charge through
  `/api/merchant/charge`:
  https://testnet.nearblocks.io/txns/9VqKERqdHEiiF2wk6bEeV1ucSdihBLYnWnxN7pTCBcWr
- **MCP agent charge:** Tab #17 (spender `tab-agent.testnet`) paid 1 tUSDC to
  `tab-merchant.testnet` through `tab_charge_invoice`:
  https://testnet.nearblocks.io/txns/5CeLAGecBQdqqtdXKEEhTzYTEUDuD6tfBuHL7PU9LN1n
- **Gasless NEP-366 charge:** `pnpm test:meta` → 12/12. The relayer paid gas;
  the merchant and agent NEAR balances were unchanged; the agent's redirected
  charge was rejected:
  https://testnet.nearblocks.io/txns/J78NCm2FpxzyUcNm3gBz1egBbfMH8J3QKosaqA2ithrS
  (agent gasless:
  https://testnet.nearblocks.io/txns/3rNjBBf2G2LZ3CoiQaUgHFpMrhJbczc42nh8bgs8V6Q4;
  rejected redirect:
  https://testnet.nearblocks.io/txns/Dbagm7mBDcTYrDA9L4g271XBDMDig2q6fJedkfjik2zx).
- **Browser gasless route:** `pnpm test:web-gasless` → 3/3, 10 tUSDC settled:
  https://testnet.nearblocks.io/txns/GsZpgNCASb3ojcuhV8nguiuyv3YAFgcC473UrBFLunjC
- **Prompt-injection containment:** `pnpm test:agent-attack` → 4/4. The
  attacker charge was rejected with `RECEIVER_NOT_ALLOWED`:
  https://testnet.nearblocks.io/txns/2wKAwrNvPRbWtZREobK6xZxB6iEyYhhaKVMLNgQB9fkx
- **x402-style agent API:** `pnpm test:x402` → 13/13 on Tab #73. The paid
  fetch, redirect, over-cap and revoke transactions are real; the API verifies
  the vault-emitted `charge_executed` event:
  https://testnet.nearblocks.io/txns/AnuVqhJkEBhtTshDhs5Vk3WUjxjxMCH62BmJZwj8tPpX
  (redirect rejected:
  https://testnet.nearblocks.io/txns/EegUMwMK65nRbJK9xtn1PnsoDuRWPX7JSXwLxGrpCit;
  over-cap rejected:
  https://testnet.nearblocks.io/txns/97KDicdXbprPRrs8X6p3pt4KV18kMV5QKmp5YEms8vYi;
  revoked Tab rejected:
  https://testnet.nearblocks.io/txns/HFVjsWszXZuN5hVWePGWf2MRKwLbCPgzM4zrmBKG8Ece).
- **Old compromised account retired:** the superseded `731d…` account now
  has 0 access keys:
  https://testnet.nearblocks.io/txns/7TTrJmMVpRwbNkuKLh3BjoV7dHGnihhC3PfxNk3raYCt

## 11. NEAR AI Agent Market (positioning only)

- **Source:** https://near.ai/blog/introducing-near-ai-agent-market (published
  2026-02-04); https://market.near.ai/ (checked 2026-10-27); X post by
  `@NEARProtocol`, 2026-10-27 (screenshot supplied by the human).
- **Fact:** NEAR AI Agent Market is a live marketplace where agents bid on
  tasks, execute work and can receive payment in NEAR when a job completes.
  Public examples include code review, data analysis, research and
  local-services quote collection. The `@NEARProtocol` post describes the
  model as "build it, list it on Agent Market, retain ownership and revenue."
- **Live example:** https://market.near.ai/a/local-services-quote-agent — a
  "Local Services Quote & Availability Collector" by AI Cloud Studio, created
  2026-10-17, listed at $2.00, 0 delivered jobs at check time. This is an
  example of the market, not an endorsement or a TabWrit integration.
- **Use in TabWrit:** positioning for the `agents` and `realworld` story.
  Agent Market handles the job payment; TabWrit handles the agent's operating
  spend (data, APIs, outreach). No Agent Market integration is implemented or
  claimed.

## 12. Not verified / not claimed

- **UNVERIFIED:** an executed 1Click mainnet settlement from a Tab vault.
  This requires a funded mainnet vault and real USDC. The repository
  implements and quote-tests the path but does not spend mainnet funds.
- **UNVERIFIED:** an independent third-party security audit. None has been
  performed.
- **UNVERIFIED:** production-scale load, adversarial token contracts, a
  mainnet storage-registrar operation, or a mainnet NEP-366 relayer. The
  deployed relayer is testnet-only and sponsor-funded.
- **NOT CLAIMED:** full x402 protocol compatibility. The demo implements an
  x402-style HTTP 402 challenge with a custom `tabwrit` scheme and an
  in-memory invoice store. The on-chain payment verification is real; the
  protocol is not a complete x402 implementation.
- The test token is not USDC and has no value. It is not presented as a
  stablecoin.

## 13. NEAR Hackathon live rules (re-checked 2026-11-01)

- **Source:** https://nearhackathon.com/HACKATHON.md
- **X post:** must say the project was built at NEAR HACKATHON, tag
  `@NEARProtocol`, use `#NEARHackathon` (optionally `@NearLegion` and
  `@NearBuilders`), and attach the demo video or screenshots.
- **Q-012:** a local-only demo is acceptable only with a public repository, a
  reproducible README and an X post with a **video**; screenshots are not
  enough when judges cannot open the demo. A hosted demo is a plus; keep it up
  through 2026-11-18, ideally 2026-11-25.
- **Submission:** one submission per project/repository; each repository is
  submitted once. The window is 2026-11-01T00:00:00Z to
  2026-11-14T23:59:00Z.
- **Use in TabWrit:** hosted Vercel demo + 60-90 second captioned clip + four
  screenshots in the reply; use the exact X tags. No mainnet required.

## 14. Documentation corrections

The previous version of this file claimed a live testnet differential proof
with the old `731d…` contract and a "100% zero mock" architecture. Those
claims were not supported by the code: the old contract had no deposits, the
Attack Lab marked scenarios PASS without transactions, and a hardcoded
full-access key existed in the web source. The current file records only what
was re-checked and linked above; the audit is in `docs/AUDIT.md`.
