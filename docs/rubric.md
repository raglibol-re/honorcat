# HonorCat: definition of "ready to submit"

Each item needs evidence in docs/rubric-evidence.md: a link, a test
name, a screenshot path or a command output. No evidence, not done.

## Works end to end
- [ ] The scripted run passes against production twice in a row: one
      early payout, one refund.
- [ ] A new user completes the recipient flow on a phone without help.
- [ ] No console errors and no failed requests on any page.
- [ ] Every page handles loading, empty and error states.

## Clear in the first minute
- [ ] The landing page states what HonorCat does in one sentence and
      shows one live example.
- [ ] A first-time visitor can start the demo template in under
      60 seconds. Record the click path.
- [ ] No unexplained jargon outside the "Under the hood" drawer.

## Technical rigour
- [ ] Full test suite green, including the trigger replay tests.
- [ ] Threat model document is current.
- [ ] Static analysis runs in CI with no unexplained findings.
- [ ] README explains setup, architecture and every Arc-specific choice.

## Sponsor fit
- [ ] Gemini: the trigger uses live Gemini market data, and the proof
      page shows which contract and which samples.
- [ ] Arc: USDC gas handling, signature-only funding, batched payout
      and measured confirmation times are visible and documented.
- [ ] QuickNode: the live view shows events delivered by Streams, and
      the stream is running.

## Honest and safe
- [ ] Testnet banner and "not insurance" note on every page.
- [ ] The terms screen matches the actual behaviour for every edge
      case.
- [ ] No secrets in the repository or the browser bundle.

## Submission
- [ ] A written demo script for a three-minute video.
- [ ] A project description draft for Devpost.