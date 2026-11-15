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

## Second browser review (2026-11-15)
- [x] /live shows QuickNode Streams deliveries, confirmed by a real
      delivery; visitors see a neutral status, the operator hint about
      resuming the stream is on /status.
- [x] The landing page shows a current market with real data or a
      labelled replay (chart, current value, no stale date) and the
      three "How it works" steps.
- [x] Quick demo offers two labelled choices: an instant one and one
      just below the threshold, so the crossing can be watched.
- [x] Quick demo picks a market without a 10 to 15 second wait: the
      candidates are precomputed on the server.
- [x] The price chart has a readable size, axes and the threshold line;
      dates are formatted in the page language, not the browser locale.

## Submission
- [ ] A written demo script for a three-minute video.
- [ ] A project description draft for Devpost.