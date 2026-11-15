# How to find and make improvements

Repeat this cycle:
1. Check production: run the end-to-end script, open every page on
   desktop and mobile widths, read the console.
2. Compare against docs/rubric.md. List what is unchecked or weak.
3. Add candidates to BACKLOG.md with: what, which rubric item it
   serves, effort (S, M, L), and risk.
4. Pick exactly one: the smallest change that closes the most
   important gap. Fixes and polish come before new features.
5. Implement it, test it, deploy it, re-run the end-to-end script.
6. Record it in PROGRESS.md and add evidence to rubric-evidence.md.

Limits:
- A new feature is allowed only if it serves a rubric item and is
  effort S or M. Never more than one unfinished feature at a time.
- Do not change the vault, redeploy contracts, add paid services,
  rename the product or change the spec. Put such ideas under "Needs
  decision: Later" and move on.
- If the end-to-end script fails after a change, fix or revert before
  doing anything else.
- If the same problem survives three attempts, write it under "Blocks
  current milestone" and stop.
- Testnet only. Secrets only in environment variables.