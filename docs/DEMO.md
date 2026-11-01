# DEMO.md - TabWrit final 2:50 shooting script

**Status:** Final shooting script for the NEAR Hackathon 2026 submission.  
**Runtime:** 2:50 (170 seconds). Full video for YouTube; 60-90 second teaser for X.  
**Product state:** NEAR testnet only. 23/23 Attack Lab, 12/12 NEP-366, 4/4 prompt-injection, 13/13 x402 agent API, 3/3 web gasless, 5/5 gas meter, 10/10 UI E2E. Vault `tab-vault.testnet` has **0 access keys**.  
**Language:** English voiceover (primary), with an optional Turkish voiceover and English captions. The English captions in this file are canonical. Clean voiceover text for recording or ElevenLabs is in [`DEMO_VO_EN.txt`](DEMO_VO_EN.txt); the TTS-friendly version is [`DEMO_VO_EN_TTS.txt`](DEMO_VO_EN_TTS.txt). The Turkish companion is [`DEMO_TR.md`](DEMO_TR.md).

**Screenshots:** the live "Start here" line allows a video or screenshots, but
Q-012 says a local-only demo needs a video; screenshots are not enough when
judges cannot open the demo. The safe path is a **60-90 second captioned clip**
plus four annotated screenshots in the first reply; see
[`SCREENSHOTS.md`](SCREENSHOTS.md). The 2:50 video below is optional and should
not delay the submission.

> **Hackathon rule:** the public X post must say the project was built at NEAR HACKATHON and must attach the demo video or screenshots. The repository must be public by `2026-11-14T23:59:00Z`. The submission `demoUrl` is the **X post URL**, not the YouTube URL. Do not post, push, or submit without the human's explicit approval.

---

## 0. What this video must prove

1. A prompt-injected agent is stopped by the **contract**, not by a backend or a prompt.
2. A real merchant payment settles; gasless NEP-366 works; the merchant's NEAR balance is unchanged.
3. The vault is immutable: **0 access keys**, no deployer backdoor.
4. An agent can pay an HTTP 402 API from its Tab; the API verifies the on-chain receipt.
5. The cross-chain route is a **live 1Click quote**, not a settlement.

**Must not claim:** a mainnet settlement, an external audit, production traffic, real customers, full x402 compliance, or a token.

---

## 1. Deliverables

| File | Spec |
| :--- | :--- |
| Full video | 2:50, 1920x1080, 30 or 60 fps, MP4 H.264, English captions burned in |
| Teaser | 60-90 seconds, same first 10 seconds + x402 + close |
| Captions | English, burned in; optional `.srt` for YouTube |
| Thumbnail | 1280x720, "Prompt injection rejected on-chain" + "23/23 Attack Lab" |
| X post | Public, says "Built at NEAR HACKATHON", teaser attached |
| Submission | `demoUrl` = X post URL; `projectUrl` = public repository |

---

## 2. Before recording

### 2.1 Hosted demo and keeper

- [ ] The web app is live on a **public URL**, not `localhost`. Replace `[HOSTED_DEMO_URL]` in this script only after it is live.
- [ ] The keeper is live if the video shows the gasless toggle. If the keeper is down, hide the gasless toggle and do not claim gasless.
- [ ] The app is tested in incognito and on a 390px mobile viewport.
- [ ] The server holds only the merchant's scoped key; no owner key is on the server.

### 2.2 URLs and repository

- [ ] `https://github.com/Lesnak1/tabwrit` is public, or you will add it in editing after 2026-11-01.
- [ ] `[HOSTED_DEMO_URL]` is live and returns the app.
- [ ] The repository has `JUDGE.md`, `REPRODUCE.md`, and the evidence files.
- [ ] Do not show a dead URL in the final export. A 404 is worse than no URL.

### 2.3 Wallet and Tab

- [ ] Use a clean demo wallet with testnet NEAR and tUSDC only. Do not show a personal wallet with other assets.
- [ ] Pre-fund the vault and pre-create one Tab to avoid waiting on camera.
- [ ] If you record a fresh deposit, you may cut the wallet popup; keep the transaction link visible for 2 seconds.
- [ ] Use these exact Tab values:

| Field | Value |
| :--- | :--- |
| Spender | `tab-merchant.testnet` |
| Per-charge cap | `10` tUSDC |
| Period budget | `10` tUSDC |
| Lifetime cap | `120` tUSDC |
| Period | `30` days |
| Expiry | `365` days |
| Receiver policy | `Allowlist` -> `tab-merchant.testnet` |
| Label | `Cloudline subscription` |

### 2.4 Browser and desktop

- [ ] Use a clean browser profile. Hide the bookmarks bar and all extensions that show notifications.
- [ ] Close Slack, Discord, mail, and personal tabs.
- [ ] Enable Windows Focus Assist / macOS Do Not Disturb.
- [ ] Browser zoom: 100-110%. The UI text must be readable at 1080p.
- [ ] Use the hosted URL in the address bar; do not show `localhost`.
- [ ] No `.env`, private key, seed phrase, wallet export, or personal data on screen.

### 2.5 Terminal

- [ ] Dark theme, font 16-18 pt, clean scrollback.
- [ ] Do not run `cat .env`, `env`, or any command that prints a secret.
- [ ] Run the tests once before recording so the output is warm and visible:

```bash
pnpm test:agent-attack
pnpm test:x402
pnpm test:meta
```

- [ ] If a test fails, fix it before recording. Do not fake a result.

### 2.6 Audio

- [ ] USB microphone or headset; quiet room with soft surfaces.
- [ ] Test 10 seconds and listen with headphones.
- [ ] Record the voiceover separately from the screen recording.
- [ ] Keep 20-30 cm from the mic; avoid plosives; speak slightly slower than normal.
- [ ] Record in segments, one per scene: `01_attack`, `02_hero`, `03_vault`,
      `04_tab`, `05_merchant`, `06_evidence`, `07_x402`, `08_quote`,
      `09_gasless`, `10_close`. Keep 0.5 seconds of handle on each side.

### 2.7 Evidence tabs

Open these in a second browser window:

- `/lab` - the 23/23 Attack Lab and the NEP-366, agent, and x402 cards.
- `https://testnet.nearblocks.io/address/tab-vault.testnet` - Access Keys shows **0**.
- `docs/evidence/agent-x402.json` - 13/13.
- `docs/evidence/meta-tx.json` - 12/12.
- `docs/evidence/agent-attack.json` - 4/4.
- `docs/evidence/relayer-usage.json` - 5/5.

---

## 3. Current evidence snapshot (2026-10-26)

| Evidence | Result | File |
| :--- | :---: | :--- |
| Attack Lab | **23/23** | `docs/evidence/testnet-e2e.json` |
| NEP-366 gasless | **12/12** | `docs/evidence/meta-tx.json` |
| Prompt-injection containment | **4/4** | `docs/evidence/agent-attack.json` |
| x402-style agent API | **13/13** | `docs/evidence/agent-x402.json` |
| Browser gasless checkout | **3/3** | `docs/evidence/web-gasless.json` |
| Relayer gas meter | **5/5** | `docs/evidence/relayer-usage.json` |
| Browser UI E2E | **10/10** | `docs/evidence/UI_E2E.md` |
| Vault access keys | **0** | [NearBlocks](https://testnet.nearblocks.io/address/tab-vault.testnet) |

Latest x402 snapshot (Tab #73; re-run `pnpm test:x402` to refresh):

| Check | Transaction |
| :--- | :--- |
| Paid fetch | [AnuVqhJk...](https://testnet.nearblocks.io/txns/AnuVqhJkEBhtTshDhs5Vk3WUjxjxMCH62BmJZwj8tPpX) |
| Redirect rejected | [EegUMwMK...](https://testnet.nearblocks.io/txns/EegUMwMK65nRbJK9xtn1PnsoDuRWPX7JSXwLxGrpCit) |
| Over-cap rejected | [97KDicdX...](https://testnet.nearblocks.io/txns/97KDicdXbprPRrs8X6p3pt4KV18kMV5QKmp5YEms8vYi) |
| Revoked Tab rejected | [HFVjsWsz...](https://testnet.nearblocks.io/txns/HFVjsWszXZuN5hVWePGWf2MRKwLbCPgzM4zrmBKG8Ece) |

---

## 4. 2:50 timeline (overview)

| Time | Scene | Purpose |
| :--- | :--- | :--- |
| 0:00-0:10 | Cold open: the attack | Hook with the strongest security proof |
| 0:10-0:22 | The product | What TabWrit is, in one sentence |
| 0:22-0:38 | The vault | Owner custody; wallet-signed actions |
| 0:38-0:56 | The Tab | Caps, expiry, receiver policy, scoped key |
| 0:56-1:22 | Gasless merchant payment | Real payment; relayer pays gas |
| 1:22-1:38 | On-chain evidence + 0 keys | 23/23 real checks; immutable vault |
| 1:38-2:02 | x402 agent API | Agent pays a 402 invoice; API verifies receipt |
| 2:02-2:16 | Cross-chain quote | Live 1Click quote; honest boundary |
| 2:16-2:34 | Gasless proof | 12/12; balances unchanged; abuse refused |
| 2:34-2:50 | Close | Brand, repo, hosted demo, testnet disclaimer |

Total: **170 seconds**. If the voiceover runs long, cut pauses in
`0:56-1:22` or `2:16-2:34`. Never cut the first 10 seconds or the x402 result.

---

## 5. Shot-by-shot script

### 0:00-0:10 - Cold open: the contract says no

**Screen:** terminal, large font, dark theme.

**Do:** run `pnpm test:agent-attack` before recording and capture the output. If you use the last verified run, open the terminal scrollback. Do not fabricate the lines.

Show the actual lines from the run; the lines below are the expected shape, not
a re-typed mock. Do not replace real terminal output with a graphic:

```text
[PASS] A1 Contract rejects the redirected charge
       REJECTED reason=RECEIVER_NOT_ALLOWED
[PASS] A2 No funds moved and the Tab nonce was not consumed
       attacker 0->0 spent=0 nonce=0
```

Add a red `REJECTED` overlay for 0.5 seconds.

**English VO:**
> This AI agent was told to pay an attacker. The contract said no. No funds
> moved, and the agent's nonce was not consumed.

**Caption:** `This agent was told to pay an attacker. The contract said no.`

**Transition:** hard cut to the landing hero on the beat "said no".

---

### 0:10-0:22 - The product

**Screen:** `/` landing hero.

**Do:** start on the hero title. Slowly scroll to the stat row; highlight `23/23` and `13/13` with a subtle zoom.

**English VO:**
> TabWrit gives merchants and AI agents a capped, expiring, revocable spending
> Tab. A prompt injection hits the contract, not your wallet.

**Caption:** `Capped, expiring, revocable spending Tabs.`

**Transition:** cut to `/app`.

---

### 0:22-0:38 - The vault

**Screen:** `/app`.

**Do:** connect the demo wallet. Show the available balance and the vault contract link. If you record a fresh deposit, cut the wallet popup and keep the transaction link visible for 2 seconds.

**English VO:**
> The owner funds a vault once. Every owner action is signed in their own
> wallet. The server never holds the owner key.

**Caption:** `The owner keeps custody. The server never holds the owner key.`

**Proof:** show the deposit transaction or the live vault balance; do not show a private key.

**Transition:** open the **Open a Tab** modal.

---

### 0:38-0:56 - The Tab

**Screen:** **Open a Tab** modal, then the new Tab card.

**Do:** enter the values from the table in section 2.3. Sign `create_tab`. Show the Tab card: per-charge cap, period budget, lifetime cap, expiry, receiver policy, nonce.

**English VO:**
> For each merchant or agent, the owner opens a Tab: a per-charge cap, a period
> budget, a lifetime cap, an expiry, and a receiver policy. The spender gets a
> Function-Call key scoped to charge. It cannot withdraw, pause, revoke, or
> change the rule.

**Caption:** `Per-charge cap. Period budget. Lifetime cap. Expiry. Receiver policy.`

**Proof:** show the `tab_created` transaction link for 2 seconds.

**Transition:** cut to `/merchant`.

---

### 0:56-1:22 - Gasless merchant payment

**Screen:** `/merchant`.

**Do:** connect the owner wallet. Select the Tab. Keep **Gasless via NEP-366 relayer** checked. Click **Pay gasless 10 tUSDC**. Show the receipt: `Gas paid by relayer`, the tx hash, and the NearBlocks link.

**English VO:**
> The customer does not sign again. The merchant's scoped key signs a NEP-366
> delegate off-chain, and the relayer pays the gas. The merchant's NEAR balance
> stays unchanged. The contract still enforces the caps and consumes the nonce.

**Caption:** `Gasless payment. The relayer pays. The merchant's NEAR stays unchanged.`

**Proof:** receipt + `charge_executed` + NearBlocks. Hold for 2 seconds.

**Transition:** cut to `/lab`.

---

### 1:22-1:38 - On-chain evidence and 0 keys

**Screen:** `/lab`, then NearBlocks.

**Do:** show the 23/23 header and one rejected row (for example `S4` or `S11b`). Then cut to `https://testnet.nearblocks.io/address/tab-vault.testnet` -> **Access Keys** -> **0 access keys**.

**English VO:**
> These are not simulated results. Twenty-three adversarial checks are real
> testnet transactions. The final vault has zero access keys. There is no
> deployer backdoor.

**Caption:** `23/23 real testnet checks. 0 access keys.`

**Proof:** `/lab` + NearBlocks access-key list.

**Transition:** cut to the terminal.

---

### 1:38-2:02 - x402 agent API

**Screen:** terminal, then `/lab` x402 card.

**Do:** run `pnpm test:x402` before recording and capture the output. Show:

- `X1` - the 402 challenge with an invoice.
- `X2a` - `status=PAID`.
- `X7a` / `X7b` - `RECEIVER_NOT_ALLOWED`.
- The final `RESULT: 13/13`.

Cut the long wallet/RPC waits. Do not fake the lines.

**English VO:**
> An unpaid API request returns a real HTTP 402 invoice. The MCP tool pays it
> from the agent's Tab. The API returns data only after verifying the vault's
> charge-executed event. Replay, wrong payer, over-cap, a redirected receiver,
> and a revoked Tab are all rejected. Thirteen out of thirteen.

**Caption:** `HTTP 402 -> Tab payment -> on-chain receipt. 13/13.`

**Proof:** terminal output + the `/lab` x402 card.

**Note:** the x402 test creates its own agent Tab (Tab #73 in the 2026-10-26
snapshot). It is separate from the merchant subscription Tab in the UI. If you
mention the number, call it "a separate agent Tab"; do not imply it is the same
Tab as the merchant payment.

**Transition:** cut to `/merchant`.

---

### 2:02-2:16 - Cross-chain quote

**Screen:** `/merchant`, **Cross-chain payout preview**.

**Do:** select **Base**. Enter a valid Base address you control. Click **Get live 1Click quote**. Show the quote panel and the **quote-only** label. Do not click any settlement control; there is none.

**English VO:**
> This is a live 1Click mainnet quote: ten USDC on Base, the required input, and
> the fee buffer. It is a quote, not a settlement. The testnet demo stops here.

**Caption:** `Live 1Click quote. Not a settlement.`

**Proof:** the live quote panel. No destination transaction.

**Transition:** cut to `/lab`.

---

### 2:16-2:34 - Gasless proof

**Screen:** `/lab`, **NEP-366** card and **x402** card.

**Do:** show `12/12`, the gas meter row `7 relays - 0.4995 NEAR` (current
accumulated snapshot), and the `AGENT` card `4/4`.

**English VO:**
> Twelve gasless checks: the merchant and the agent both charge without paying
> NEAR gas. The relayer pays; both balances stay unchanged. Replay, a tampered
> signature, and a FullAccess-key delegate are refused. The keeper meters
> actual gas per sender for prepaid credits.

**Caption:** `12/12 gasless. Balances unchanged. Abuse refused.`

**Proof:** `/lab` cards + `docs/evidence/meta-tx.json`.

**Transition:** cut to the landing final section.

---

### 2:34-2:50 - Close

**Screen:** landing final section.

**Do:** overlay the brand and URLs:

```text
TabWrit
Every Tab has a Writ.

Built at NEAR HACKATHON 2026
https://github.com/Lesnak1/tabwrit
[HOSTED_DEMO_URL]

Testnet only. 1Click is a quote, not a settlement.
```

Do not export with `https://github.com/Lesnak1/tabwrit` or `[HOSTED_DEMO_URL]` placeholders. Replace them with live URLs, or add them in editing after the repository is public.

**English VO:**
> TabWrit. Every Tab has a Writ. Built at NEAR HACKATHON 2026. The repository
> and the live testnet demo are below. Testnet only. 1Click is a quote, not a
> settlement.

**Caption:** `TabWrit. Every Tab has a Writ. Built at NEAR HACKATHON 2026.`

**End card:** hold for 2 seconds. No music sting; let the URL breathe.

---

## 6. Voiceover options

### 6.1 English voiceover (primary)

- Read [`DEMO_VO_EN.txt`](DEMO_VO_EN.txt). It contains only the ten spoken paragraphs, in scene order, with no headings for the narrator to read.
- Record one scene at a time. Keep the same order and timings as the shot list.
- The script is about 318 words. At 140-150 words per minute it runs about 2:07-2:16, leaving 34-43 seconds for pauses, screen changes and transaction links.
- Speak slightly slower than normal. Pause after "The contract said no." and after "Thirteen out of thirteen."
- If a line goes wrong, re-record that scene. Do not patch single words from another take; the tone will jump.
- Pronounce technical terms with the table in section 11. The captions in section 5 stay canonical even if your pronunciation differs.
- Do not add claims that are not in the script: no mainnet settlement, no audit, no real customers, no full x402 compliance.

### 6.2 ElevenLabs backup

Use this only if the self-recorded voice is unusable. Do not mix a self-recorded voice and an AI voice in the same video; pick one voice for all ten scenes.

- Paste [`DEMO_VO_EN_TTS.txt`](DEMO_VO_EN_TTS.txt), not the canonical file. It uses TTS-friendly spellings: `A I`, `A P I`, `H T T P four oh two`, `M C P`, `N E P three sixty-six`, `U S D C`, `one click`, `Near`.
- Choose a calm, confident English voice. A neutral documentary tone fits better than a high-energy ad read.
- Starting settings: stability around 50%, similarity around 75%, style 0-15%, speaker boost on. These are starting points; test 10 seconds first.
- Generate one clip per scene, or one full file and cut it to the scene timings. Export MP3 or WAV at 44.1/48 kHz.
- The TTS text is longer than the canonical script because terms are spelled out. If the generated audio runs over 2:50, cut silence or use 1.05x; do not cut the claims.
- Test `TabWrit`, `NEP-366`, `x402`, `1Click`, `NEAR`, and `charge-executed`. If a term is wrong, use the ElevenLabs pronunciation dictionary or adjust only that term in the TTS text.
- Keep the English captions from section 5. The TTS text is a pronunciation aid, not the public caption text.
- If you use an AI voice, add "AI voiceover" to the YouTube description. The hackathon does not require it, but it is honest and avoids confusion.

### 6.3 Turkish voiceover (optional)

If you record in Turkish, use [`DEMO_TR.md`](DEMO_TR.md) for the voiceover lines. The English captions in this file are canonical; keep them exactly as written.

- Record the Turkish lines with the same timings and the same claims.
- Do not add a mainnet settlement, an audit, or a customer claim.

### 6.4 No voiceover

If you prefer no voiceover, display the English captions as text cards and use low-volume music. The video still works muted.

---

## 7. Editing

- **Timeline:** 1920x1080, 30 fps (or 60 fps for smoother UI). Cut all wallet popups and RPC waits; keep the transaction links.
- **Captions:** English, burned in. Two lines maximum, 32-40 px, high contrast, 1.5-3 seconds per line. Correct `NEP-366`, `x402`, `tUSDC`, `charge_executed`, and `RECEIVER_NOT_ALLOWED` manually.
- **Callouts:** `REJECTED`, `23/23 on-chain`, `13/13 x402`, `0 access keys`, `Gas paid by relayer`.
- **Persistent badge:** add a small `NEAR testnet` badge in the top-right for the whole video. It prevents any confusion with a mainnet demo.
- **Music:** royalty-free, no lyrics, about -24 LUFS under the voice. Voice around -14 LUFS. Final mix around -14 LUFS integrated.
- **Export:** MP4 H.264, 1080p, 8-12 Mbps, AAC 192 kbps, 48 kHz.
- **Teaser:** 60-90 seconds. Use the cold open, the merchant payment, the x402 result, and the close.
- **Thumbnail:** 1280x720. Dark background, TabWrit mark, `Prompt injection rejected on-chain`, `23/23 Attack Lab`, `13/13 x402`.

---

## 8. Publishing

### 8.1 YouTube

**Title:** `TabWrit - Contract-Enforced Spending Tabs for AI Agents | NEAR Hackathon 2026`

**Description:**

```text
TabWrit is a contract-enforced spending-Tab layer for merchants and AI agents
on NEAR. A prompt injection hits the contract, not the wallet.

Testnet only. 1Click is a live mainnet quote, not a settlement. No mainnet
settlement was executed.

Repo: https://github.com/Lesnak1/tabwrit
Hosted demo: [HOSTED_DEMO_URL]
Judge quickstart: https://github.com/Lesnak1/tabwrit/blob/main/JUDGE.md

Evidence: 23/23 Attack Lab, 12/12 NEP-366, 4/4 prompt-injection,
13/13 x402 agent API, 3/3 web gasless, 5/5 relayer gas meter.

Chapters:
0:00 The attack
0:10 The product
0:22 The vault
0:38 The Tab
0:56 Gasless payment
1:22 On-chain evidence
1:38 x402 agent API
2:02 Cross-chain quote
2:16 Gasless proof
2:34 Close

Built at NEAR HACKATHON 2026.
```

### 8.2 X post

Attach the 60-90 second captioned clip. Put the four screenshots in the first
reply. The post must be public, say **Built at NEAR HACKATHON**, tag
`@NEARProtocol` and use `#NEARHackathon` (optionally `@NearLegion` and
`@NearBuilders`). The full 2:50 YouTube video is optional.

Draft:

```text
Getting three quotes for a local job means three calls and a spreadsheet.
AI agents can do the chasing - but only if they get a budget, not your keys.

Built at NEAR HACKATHON 2026: TabWrit.
A prompt injection hits the contract, not your wallet.

One complete moment: an attacker redirect is rejected on-chain with
RECEIVER_NOT_ALLOWED; the legitimate merchant payment still settles.

NEAR Function-Call keys scope the agent to charge. NEP-366 pays gas.
NEAR Intents quotes the cross-chain payout.

Testnet demo + repo in the reply.
@NEARProtocol #NEARHackathon #NEAR #AIagents
```

Do not tag individual judges. Do not spam hashtags. Pin the post. Add a reply
with the repository, hosted demo and four screenshots.

**X video limit:** it depends on the account tier. Keep the clip at 60-90
seconds; do not risk a failed upload on submission day.

### 8.3 Submission

- `demoUrl` = the public X post URL.
- `projectUrl` = the public repository URL.
- `nearAddress` = the human's mainnet prize payout account; never the demo vault.
- The human confirms the exact JSON payload before submission.
- Do not submit before the repository is public and the X post is live.

---

## 9. Do not show / do not claim

- Do not show `.env`, a private key, a seed phrase, a wallet export, or a terminal command that prints a secret.
- Do not show personal notifications, bookmarks, other tabs, or a personal wallet with unrelated assets.
- Do not show the old `731d...` account.
- Do not show a mainnet settlement. None was executed.
- Do not show a fake PASS, a fallback number, or a simulated transaction.
- Do not label the 1Click quote as a settlement.
- Do not claim an external audit, production traffic, real customers, full x402 compliance, or a token.
- Do not show the removed local test signer.

---

## 10. Contingencies

| Problem | Response |
| :--- | :--- |
| Keeper is down | Hide the gasless toggle; use the direct merchant charge; do not claim gasless. |
| x402 test fails | Fix it before recording. If it cannot be fixed, use the last verified `docs/evidence/agent-x402.json` and label it as the last verified run; do not fabricate. |
| Wallet popup is slow | Cut the wait; keep the tx link and the receipt. |
| Hosted demo is not live | Do not export the close with a dead URL. Record the rest and add the URL in editing, or wait until the hosted demo is live. |
| 1Click quote fails | Retry. If it still fails, show the quote-only panel from a successful attempt at recording time; do not show a stale quote as live. |
| Tab caps are exhausted | Create a fresh Tab before recording. Do not show a failed payment as a success. |
| Wrong network | Check the testnet badge. Never record a mainnet screen for this video. |

---

## 11. English voiceover pronunciation

| Term | Say |
| :--- | :--- |
| NEAR | "near" (not "N-E-A-R") |
| TabWrit | "Tab-rit" (pick one and stay consistent) |
| NEP-366 | "N-E-P three sixty-six" |
| NEP-141 | "N-E-P one forty-one" |
| 1Click | "one-click" |
| x402 | "x-four-oh-two" |
| tUSDC | "test U-S-D-C" |
| MCP | "M-C-P" |
| `charge_executed` | "charge executed" |
| `RECEIVER_NOT_ALLOWED` | "receiver not allowed" |

---

## 12. Final checklist

- [ ] Hosted demo is live and tested in incognito and mobile.
- [ ] Keeper is live if the gasless toggle is shown.
- [ ] Repository is public, or the URL will be added in editing after 2026-11-01.
- [ ] Wallet has testnet NEAR + tUSDC only; no personal assets.
- [ ] Pre-created Tab uses the exact values in section 2.3.
- [ ] Browser is clean; notifications are off; no secrets on screen.
- [ ] Voiceover is recorded separately; English captions are burned in.
- [ ] First 10 seconds are the attack rejection, not a logo.
- [ ] Every claim has a visible transaction or test output.
- [ ] 1Click is labeled quote-only.
- [ ] Close shows live `https://github.com/Lesnak1/tabwrit` and `[HOSTED_DEMO_URL]`.
- [ ] Full video is 2:45-2:50; teaser is 60-90 seconds.
- [ ] X post is public, says "Built at NEAR HACKATHON", and attaches the teaser.
- [ ] Submission `demoUrl` is the X post URL.
- [ ] The human approved the post and the submission payload.

---

## 13. Human gates

- Do not publish the X post without the human's explicit "yes".
- Do not push or make the repository public before 2026-11-01T00:00:00Z.
- Do not submit without the human's explicit confirmation of the full JSON payload.
- Do not sign or send any mainnet transaction for this video. The 1Click panel is a quote only.
