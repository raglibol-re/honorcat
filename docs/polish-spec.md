# HonorCat polish: usable alone, true to the name

Goal: a first-time visitor understands the product in one minute, can
try it alone in two, and meets a cat on every screen. Money, prices
and the test-money notice stay plain and free of wordplay.

## P1. Try it alone
- A practice opponent run by the relay takes the other side of a
  visitor's pot on testnet. Label it clearly as practice, and keep
  practice pots out of the honor record and public numbers.
- A button that sends a new visitor a small amount of test USDC, with
  a limit per account and per day.
- Acceptance: a new visitor creates a pot, watches the rope and exits
  within two minutes, alone, on a phone.

## P2. Your own cat instead of an address
- On first visit, a person picks a fur colour and a name for their
  cat. This is their identity everywhere: at their post on the rope,
  in invitations, lists and the honor record.
- Addresses appear only under "Show technical details".
- Names are display only and never used for authorisation. Filter
  offensive names and keep them short.
- Three cats in the pot view: each player's cat at its post, reacting
  to how its side is doing, and the market cat on the rope.

## P3. Plain questions and three numbers
- Show every market as a plain statement and its opposite, for
  example "Cleveland beats Chicago" and "Cleveland does not beat
  Chicago", with league, date and local start time. Replace YES and
  NO in the interface with these statements; keep YES and NO in the
  technical details.
- On the pot page show three amounts, large: what I get if I leave
  now, if I stay and my side happens, and if I stay and it does not.
- When creating a pot, the person enters only their own amount. Show
  "Your opponent puts in X. The pot is Y." and one line explaining
  that the favourite costs more so nobody starts ahead.
- A filter "even markets" for contracts near 50%.

## P4. The rope
- Make it read as a rope between two posts, not a bar: the 0 to 100
  scale with ruler ticks, the paw trail of the recent path, the net
  at a side's floor and the bowl at its target when set.
- Fill the rope in each player's colour on their side of the cat.
- Match the approved mockups and the cat pose sheet.
- Keep the big-screen version in step with it.

## P5. An exit that explains itself
- Before confirming, show an estimate and the sentence that the final
  price is the average of the next 30 seconds and that the request
  cannot be withdrawn.
- During the window: the crouch, a ring counting down, the jump, the
  landing and a stamp with the price.
- Afterwards: what each side received, the fee, and a link to the
  evidence.
- Partial exits are labelled as such, and the page shows what remains
  in the pot. Fix pot pages that show an exit price while still
  reading as a full live pot.
- Do not describe the exit as instant anywhere.

## P6. Honor, made visible
- Handshake as its own button next to the exit, with the two cats
  giving a paw. Explain in one line that it splits now at the current
  price with no fee, if both agree.
- A code of honor at the top of every terms page, three sentences:
  anyone may leave at any time; nobody gains by being faster; the
  market decides, not us. The full terms follow below it.
- After a pot ends, each side can send "Well played" and offer a
  rematch on a new market.
- Honor record: keep the facts, and give them plain labels such as
  "holds to the end" or "often splits by handshake". No invented
  score.
- Wording: joining is "give your word"; the exit fee is "a treat for
  the other cat". Show the dollar amount next to it every time.

## P7. A cat in every state
- Loading: the cat peeks in. Empty list: it sleeps. Error: it looks
  into an empty box. Success: it lands. Waiting for an opponent: it
  sits at the post.
- Small signs of life: a blink, a swaying tail, a wobble when the
  price moves fast. Respect reduced-motion settings and give every
  pose a text alternative.
- Bring back the closing block shaped like a cat's face at the end of
  the landing page if it was lost in the cleanup.
- One cat component only. No emoji, no stock art.

## P8. Landing page and sharing
- Under the headline, a three-line worked example with two cat names
  and dollar amounts: the start, a moment when one leaves, and what
  each gets.
- Invitation by link and QR code, with a preview image showing the
  rope and the question.

## P9. Clear messages and access
- Every error and refusal in plain language with what happens next,
  for example: "The market is too thin for an exit right now. The
  final result decides."
- Animated amounts get a plain text label for screen readers.
- Check every page at phone width and with keyboard only.

## P10. Loose ends from the review
- The sponsor page counts 19 price windows but lists 14. Fix the
  count or the breakdown.
- Report the share of events first seen by QuickNode Streams since
  the filter was set, and make sure Streams is the primary path.
- Finish decoding the Arc memo on the pot page, which the sponsor
  page marks as "Partly".

## Rules
- No contract changes. If something seems to need one, stop and tell
  me.
- Testnet only. Secrets only in environment variables.
- Keep the design system and the wording rules. Amounts, prices and
  the test-money notice stay plain.
- Each part ends with tests green, deployed, and its acceptance
  checks added to docs/rubric.md and passing.
- Keep PROGRESS.md current. Stop only on entries under "Blocks
  current milestone".
