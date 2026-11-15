# Progress

## Done
- Phases A, B, G (Merkle payouts, e2e `drops` passing on production), HonorCat guarantees, market picker.
- Early payouts (docs/early-payout-spec.md): Gemini data checked, plan written. No code yet.

## Next (after the decisions below)
- M1 trigger engine and replay tests, M2 funder flow and live view, M3 recipient flow, evidence, post-settlement record, M4 e2e on the demo template.

## Blocked
- Everything under "Needs decision".

## Needs decision
1. Where the samplers run (Vercel cannot sample every few seconds). Options in the plan; recommendation: 3 small always-on sampler processes, 2-of-3 signatures.
2. How the evidence hash is bound to the result without a vault change: signers also sign an off-chain EIP-712 trigger attestation (potId, evidenceHash, params hash) that is published and put in the payout memo (recommended), versus changing the vault digest (not recommended).
3. Default trigger parameters per template (window, sample interval, max spread, min size per side, min valid samples, max staleness).
4. Edge cases for the terms screen: market invalid/voided or under review, no settlement by the deadline, data outage during the window, contract closed for trading before settling, recipient cannot receive.
5. Historical "would have crossed" stats: Gemini offers only trade-price candles and 7 days of trades, no bid/ask history. Show them labelled "based on trade prices", or leave the feature out.
6. Which of the queued 8 HonorCat additions survive (the spec drops discount comparison, coupons, tiered refunds, service promises).
7. Priority of phases H, I, E, D against this work (deadline 2026-11-20).
