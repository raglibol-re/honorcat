# Demo script (3 minutes)

Production: https://verdict-phi-livid.vercel.app. Record at 1280×800 for the desktop parts and
390×844 (phone emulation or a real phone) for the recipient. Keep the testnet banner in frame.

Before recording: make sure the local sampler runs (`pnpm --filter @verdict/relay sampler`) and
the stream is live (`/live`). Open the demo market in advance (step 2) so its book is warm.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:15 | Landing page | "HonorCat pays people before something happens. Money is set aside on Arc and released the moment a Gemini prediction market considers the event very likely, so people can prepare. Afterwards we record publicly whether the market was right." |
| 0:15–0:45 | `/early/new`, click **Use the demo market** | "Any live Gemini market works. For the demo, HonorCat watches order books for twelve seconds and picks the one that meets the rules right now: here, [contract], at [x]%. I pay three people ten cents each if it stays at 85% or more." Show the slider, the live chance, the trade-price chart, the pot mode. |
| 0:45–1:05 | Click **Set aside … and publish**, sign once in the wallet | "One signature. No approval transaction, no gas: Arc's USDC supports signed transfers, and our relay submits create, fund and open in a single batched transaction." Show the share link and QR. |
| 1:05–1:30 | Phone: open the link, **Join with a passkey** | "A recipient joins with a passkey. No wallet, no app, nothing to file. The passkey account is verified on-chain through Arc's P-256 precompile." Show "You are on the list". |
| 1:30–2:15 | Live view `/e/[id]` | "Three independent samplers, on the Vercel app, GitHub Actions and this laptop, read Gemini's public order book every two seconds. A reading only counts with a tight spread, real size on both sides and fresh data. The thick line is the average that decides; a single spike never pays." Wait for **Triggered → Paid**. "Two of three signed from their own data, and everyone was paid in one transaction, [n] minutes before the market closes." |
| 2:15–2:40 | Proof page `/e/[id]/proof` | "Anyone can check it: every sample, recomputed right here in the browser with the same engine; each sampler's signature; and the evidence root that is in the payout memo on Arc." Click the payout transaction on the explorer, show the memo. |
| 2:40–2:55 | `/live` | "QuickNode Streams delivers every block's events to the app; it also keeps one of the samplers awake. Settlement on Arc is final in about a second and costs fractions of a cent in USDC." |
| 2:55–3:00 | Back to the card | "HonorCat: promises that always land. Paid before it happens." |

Fallback if no market meets the demo rules at recording time: use a pot created earlier that paid
(for example `/e/IEDYXffahH`) and walk through its live view and proof page.
