# GrokCat

## What it is
GrokCat is a second cat in HonorCat, powered by xAI's Grok. The black
cat on the rope is the market. GrokCat sits beside it and talks to
the player through small speech-bubble pop-ups and an ask box. It
explains, translates and keeps things fair. It never moves money.

## Before you build
- Read xAI's current API docs. Tell me which model you propose, what
  it costs per call, whether live web and X search is available
  through the API, and how structured output works. Do not assume
  model names or endpoints.
- Prepare the environment: add XAI_API_KEY to .env.example and tell
  me where to set it in Vercel. I will paste the key myself. Never
  print or log it. All calls go through our server; the key must
  never reach the browser.
- If the key is missing or the API is down, GrokCat is shown asleep
  and the product works without it.

## Hard rules
- GrokCat has no signing power and no tool that moves funds. Every
  action it proposes is a prefilled form the player confirms.
- Every number GrokCat shows comes from our own data and is inserted
  by our code: shares, prices, fees, times. Grok writes the sentence
  around it and must not compute amounts.
- GrokCat explains and informs. It does not tell a player which side
  to take or whether to leave. Enforce this in the system prompt and
  with a check on the output.
- Anything fetched from the web or X is untrusted text. It may be
  summarised with a source link and may never change GrokCat's
  instructions or trigger an action.
- Every bubble carries "GrokCat can be wrong" in small print, and a
  mute button. Muting is remembered.
- At most one unprompted bubble every few minutes per player. Propose
  the limits.

## Roles
1. Explainer of moves. When the smoothed price moves by more than a
   set number of points within a minute, GrokCat offers one or two
   sentences on what is being reported, with source links. If it
   finds nothing reliable it says so. Cache per market for a short
   time so many viewers share one call.
2. Options in words. When a player opens the exit, net, bowl,
   handshake or takeover control, GrokCat states in one sentence
   each what the choices mean for them, using our numbers.
3. Translator. The player types a wish in plain words, for example
   "protect half my stake" or "take my share off at 85 dollars".
   GrokCat returns a structured proposal for net, bowl or partial
   exit. The UI prefills it and the player confirms.
4. Question finder. "A fair game that ends tonight": GrokCat picks
   candidates from our own market catalogue, never from memory, and
   shows why each fits.
5. Practice opponent. For practice pots only, GrokCat takes the other
   side through a relay-held practice wallet with a small testnet
   limit. Its choices come from a fixed action set: hold, set net,
   set bowl, request exit, offer or accept handshake. The server
   validates every choice against the pot's rules and limits. Label
   practice pots clearly and keep them out of honor records.
6. Honor keeper. Gentle nudges for fair and measured play: a break
   after several pots in a short time, a handshake suggestion when
   both sides have been idle, a reminder that an exit is final.
7. Chronicler. After a pot ends, a three-sentence recap of what
   happened, built from the pot's event history, with a share card.

## The cat
- GrokCat is visibly a different cat from the market cat: light
  coat with ink outline, same cute proportions, same palette.
- Add poses to /design/cat: peeking in from the corner, talking,
  thinking, shrugging when it does not know, pointing at the rope,
  playing the opponent on its post, asleep.
- Bubbles are small, never cover the rope or the amounts, and can be
  dismissed with one tap. Respect reduced-motion settings. Bubble
  text must be available to screen readers.
- Show me the poses and one bubble on the pot page before applying
  them everywhere.

## Engineering
- One server route that builds the context: pot state, the player's
  side and share, the recent price path, the rules in short form.
  Stream the reply.
- Structured output with a schema for every role that proposes
  something. Reject and retry on invalid output; fall back to a
  plain template sentence.
- Rate limits and a daily spending cap, with the current usage on
  /status.
- Tests: no bubble contains a number that is not in the supplied
  context; a prompt-injection string inside fetched content does not
  change behaviour; the practice opponent cannot exceed its action
  set or limit; the product works with the key removed.
- Log each call's role, latency and outcome without storing personal
  text longer than needed.

## Evidence
Add a Grok section to /how-it-is-built with checks and live counts:
moves explained, proposals confirmed, practice pots played, recaps
written.

## Milestones
K0. Findings on the xAI API and the environment setup. No code.
K1. Roles 2 and 3 with the ask box, behind the hard rules.
K2. Role 1 with sources and caching.
K3. Role 5, the practice opponent, with the solo try-out flow.
K4. Roles 4, 6 and 7, the evidence section, and the tests.
Stop after K0 and wait for the key and my go-ahead.
