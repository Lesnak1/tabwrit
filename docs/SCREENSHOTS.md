# SCREENSHOTS.md - short video + screenshots demo plan

The live hackathon rules (`https://nearhackathon.com/HACKATHON.md`, re-read
2026-11-01) say the public X post must have the **demo video or screenshots**
attached. The same rules add a stricter note in Q-012: a local-only demo is
acceptable only with a public repo, a reproducible README and an X post with a
**video**; screenshots are not enough when judges cannot open the demo. A
hosted demo is a plus and should stay up through 2026-11-18, ideally
2026-11-25.

**Safe path:** publish a **60-90 second captioned clip** and put four annotated
screenshots in the first reply. The clip does not need a voiceover; English
captions are enough. The 2:50 video is optional. Screenshots alone are allowed
by the "Start here" line, but the clip is safer under Q-012.

---

## 1. Why a short clip + screenshots

| Factor | 60-90s captioned clip + screenshots | 2:50 voiced video |
| :--- | :--- | :--- |
| Hackathon compliance | Meets Q-012; screenshots supplement | Meets Q-012 |
| Time to produce | 1-2 hours after Vercel | 3-6 hours including voice/edit |
| English voiceover risk | None; captions only | Depends on the recording |
| Judge scanning | 60-90 seconds + four images | 2:50 of attention |
| Proof of a flow | Strong: one complete moment | Strong |
| X post | Video post + screenshot reply | Video limits vary by account |

The clip is the primary demo; the four screenshots are the fast-scan proof.
Do not delay the submission for the 2:50 voiced video.

---

## 2. The four-image reply

Post the 60-90 second clip first. Put these four screenshots in the first
reply, because X does not mix a video and images in one post. Capture all four
from the **hosted Vercel URL**, not `localhost`.

| # | Screen | What it must show | Annotation |
| :--- | :--- | :--- | :--- |
| 1 | `/` landing hero | TabWrit, live testnet badge, `23/23 Attack Lab`, `13/13 x402` | "Contract-enforced spending Tabs" |
| 2 | `/lab` | 23/23 header and the x402 + NEP-366 cards | "23/23 real testnet checks · 13/13 x402" |
| 3 | `/merchant` | Gasless receipt: `Gas paid by relayer`, tx hash, NearBlocks link | "Gasless payment. Merchant NEAR unchanged." |
| 4 | NearBlocks vault page | `tab-vault.testnet` -> Access Keys -> **0** | "Immutable vault · 0 access keys" |

Put these in the first reply; the video is the main post attachment.

### Reply with more proof

Add a reply with two or three of:

- `/lab` prompt-injection card: `RECEIVER_NOT_ALLOWED`, attack tx.
- Terminal `pnpm test:x402`: `X1` 402 challenge, `X2a PAID`, `X7b REJECTED`, `13/13`.
- `/merchant` 1Click quote panel, labeled **quote-only**.
- `/app` Tab card: per-charge cap, period budget, expiry, receiver allowlist.

Do not attach a screenshot that shows `.env`, a private key, a seed phrase,
personal notifications, or a wallet with unrelated assets.

---

## 3. Capture rules

- Resolution: 1440x900 or 1920x1080; keep the browser at 100-110%.
- Show the **Vercel URL** in the address bar in at least the first image.
- Use a clean demo wallet with testnet NEAR + tUSDC only.
- No bookmarks bar, personal tabs, Slack/Discord notifications, or email.
- Use the current UI; retake after the final Vercel deploy.
- Add a small caption bar or callout; do not cover the key numbers.
- Do not annotate a number that is not visible in the screenshot.
- Use real transaction links in the post/reply; do not fabricate hashes.
- Add X alt text to each image. Example: "TabWrit landing page with 23/23 Attack Lab and 13/13 x402 evidence."

---

## 4. X post copy

Attach the 60-90 second captioned clip. The post must say the project was built
at NEAR HACKATHON, tag `@NEARProtocol` and use `#NEARHackathon` (optionally
`@NearLegion` and `@NearBuilders`). Put the four screenshots in the first reply.

Lead with the user problem, show one complete moment, explain NEAR's role, and
give a next step:

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

First reply:

```text
Live testnet demo: https://tabwrit.vercel.app
Repo: https://github.com/Lesnak1/tabwrit
Judge quickstart: https://github.com/Lesnak1/tabwrit/blob/main/JUDGE.md

Four screenshots below: Attack Lab 23/23, x402 13/13, gasless receipt,
and the vault with 0 access keys.

The 1Click panel is a live mainnet quote, not a settlement.
No mainnet settlement was executed.
```

If you cannot produce the clip, attach the four screenshots and make the hosted
demo prominent. That is allowed by the "Start here" line, but Q-012 makes the
clip the safer choice.

---

## 5. The 60-90 second clip

No voiceover is needed. Use English captions and a low music bed.

| Time | Screen | Moment |
| :--- | :--- | :--- |
| 0:00-0:10 | terminal | `RECEIVER_NOT_ALLOWED`, no funds moved |
| 0:10-0:30 | `/merchant` | gasless payment + `Gas paid by relayer` |
| 0:30-0:55 | terminal + `/lab` | x402 402 challenge and `13/13` |
| 0:55-1:10 | `/lab` + NearBlocks | 23/23 and `0 access keys` |
| 1:10-1:30 | landing/close | TabWrit, repo, hosted demo, testnet disclaimer |

The full 2:50 script and voiceover text remain in `DEMO.md`,
`DEMO_VO_EN.txt` and `DEMO_VO_EN_TTS.txt` if you have time.

The submission's `demoUrl` is the **X post URL**, not the video URL.
