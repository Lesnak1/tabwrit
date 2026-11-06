# JUDGE.md — TabWrit one-page quickstart

TabWrit is a contract-enforced spending-Tab layer on NEAR. A user funds a
vault, then opens capped, expiring, revocable Tabs for merchants and AI agents.
A scoped Function-Call key can charge inside the rule and cannot withdraw,
pause, revoke or attach a deposit. **A prompt injection hits the contract, not
the wallet.**

**Tracks:** `security` (primary), `agents`, `realworld`.  
**Naming:** TabWrit is the project; a Tab is the on-chain spending primitive.  
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

## Fresh-clone commands that work without the author's keys

```bash
pnpm install
pnpm test                 # 16 real Rust VM tests
pnpm demo                 # prints the committed 23/23 evidence with tx links
pnpm --filter web build   # production Next.js build
pnpm test:mcp             # 6 MCP tools, live testnet read views
```

Full testnet reproduction needs funded testnet accounts and keys. Use
`REPRODUCE.md`; do not reuse the author's live account names.

---

## 3-minute path

1. **Prompt injection:** `pnpm test:agent-attack` → the attacker charge is
   rejected on-chain; the legitimate merchant charge executes.
2. **Gasless:** `pnpm test:meta` → merchant and agent pay without NEAR gas;
   replay/tampered/FullAccess delegates are refused.
3. **x402 agent API:** `pnpm test:x402` → the agent pays a real HTTP 402
   invoice; the API verifies the on-chain receipt; replay, wrong payer,
   over-cap, redirect and revoked Tab are rejected.
4. **Product:** open `/app`, fund the vault, create a Tab; `/merchant` pays
   the invoice and links to the transaction.
5. **Evidence:** `/lab` shows the 23/23 Attack Lab and the gasless, agent and
   x402 cards.

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
