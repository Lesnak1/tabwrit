# JUDGE.md — TabWrit one-page quickstart

TabWrit is a contract-enforced spending-Tab layer on NEAR. A user funds a
vault, then opens capped, expiring, revocable Tabs for merchants and AI agents.
A scoped Function-Call key can charge inside the rule and cannot withdraw,
pause, revoke or attach a deposit. **A prompt injection hits the contract, not
the wallet.**

**Tracks:** `security` (primary), `agents`, `realworld`.  
**Naming:** TabWrit is the project; a Tab is the on-chain spending primitive.  
**Demo video (75s, captioned):** https://x.com/LesnaCrex/status/2118706276091974069  
**Live demo:** https://tabwrit.vercel.app  
**Hosted keeper:** https://tabwrit-keeper.onrender.com/health

---

## What is real on NEAR testnet

| Area | Evidence |
| :--- | :--- |
| Contract | `tab-vault.testnet`, **0 access keys**, immutable; 16 Rust tests |
| Adversarial lab | **23/23** real testnet transactions with NearBlocks links |
| Gasless merchant + agent | **12/12** NEP-366 checks; merchant and agent NEAR balances unchanged |
| Prompt injection | **4/4**; attacker charge rejected with `RECEIVER_NOT_ALLOWED` |
| x402-style agent API | **13/13**; paid fetch, replay, wrong payer/amount, over-cap, redirect, revoke |
| Browser UI | **10/10**, 0 console errors; gasless merchant payment is a real `Delegate` transaction |
| Agent/MCP | 6 tools, live read tools, real agent charge, x402 paid fetch |
| Gas meter | `GET /relay/usage` and `pnpm test:relayer-usage`; actual gas per sender |

Reports:

- `docs/evidence/testnet-e2e.json` — 23/23
- `docs/evidence/meta-tx.json` — 12/12
- `docs/evidence/web-gasless.json` — 3/3
- `docs/evidence/agent-attack.json` — 4/4
- `docs/evidence/agent-x402.json` — 13/13
- `docs/evidence/relayer-usage.json` — 5/5
- `docs/evidence/UI_E2E.md` — 10/10

---

## What is not claimed

- **No mainnet 1Click settlement was executed.** The quote preview is live;
  the cross-chain settlement path is mainnet-only and needs a funded mainnet
  vault with real USDC. The hackathon requires a working prototype, not a
  mainnet deployment; this is optional future work.
- **No external audit.** The 16 Rust tests, 23 testnet checks and threat model
  are the evidence.
- **The test token is not USDC.** `tab-usdc.testnet` has no value.
- **The gasless relayer is testnet-only and sponsor-funded.** The keeper meters
  actual gas for a prepaid-credit model, but production credit enforcement and
  mainnet pricing are not claimed. See `docs/SUSTAINABILITY.md`.

---

## No-key quickstart (start here)

These commands work without `.env`, a wallet, or the author's keys:

```bash
pnpm install
pnpm test                 # 16 real Rust VM tests
pnpm demo                 # prints the committed 23/23 evidence with tx links
pnpm --filter web build   # production Next.js build
pnpm test:mcp             # 6 MCP tools, live testnet read views
```

No wallet is needed for the hosted evidence:

- **Watch:** the 75s captioned demo:
  https://x.com/LesnaCrex/status/2118706276091974069
- **Open:** https://tabwrit.vercel.app/lab — the 23/23 Attack Lab and the
  gasless, agent and x402 cards.
- **Open:** https://tabwrit.vercel.app/merchant — the invoice and live
  quote-only 1Click preview work without a wallet.

The manual wallet flow is optional. If you use it, get testnet NEAR from
https://near-faucet.io/ or https://dev.near.org/faucet, then use the in-app
**Get 100 test tUSDC** faucet. The author-only `pnpm testnet:fund` helper
needs the demo account key and is not required.

If the hosted gasless relayer is cold, uncheck **Gasless** on `/merchant`;
the direct merchant charge still settles without the keeper. The video,
`/lab` and `pnpm demo` never depend on the keeper.

---

## Full reproduction (requires funded testnet keys)

These scripts submit real testnet transactions and need funded testnet
accounts/keys in `.env`. They are not part of the no-key path. Use
`REPRODUCE.md`; do not reuse the author's live account names.

```bash
pnpm test:agent-attack   # 4/4 prompt-injection containment
pnpm test:meta           # 12/12 NEP-366 gasless checks
pnpm test:x402           # 13/13 x402-style agent API checks
```

The committed results and transaction links are in `docs/evidence/` and are
printed by `pnpm demo` without keys.

---

## Architecture in one screen

```text
owner wallet ── ft_transfer_call ──► TabVault (immutable, 0 keys)
                                      │
merchant/agent ── scoped key ──► charge(tab_id, amount, receiver, nonce)
                                      │ checks caps, expiry, allowlist, nonce
                                      ▼
                               NEP-141 transfer ──► merchant / 1Click deposit

gasless: merchant/agent signs a NEP-366 charge delegate off-chain
         ──► keeper validates the scoped key and pays gas
         ──► chain executes the same charge as the sender
```

No owner key reaches a server. The merchant/agent key is Function-Call only,
scoped to `charge`, and cannot attach a deposit.
