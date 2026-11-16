# GrokCat K0: the xAI API and the environment (2026-11-16)

Read from docs.x.ai on 2026-11-16 (overview, models, pricing, rate limits, structured outputs, web
search, X search, citations, reasoning, chat completions, security FAQ, release notes). Some pages
name the vendor "SpaceXSI"; endpoints and model IDs are xAI's. Nothing below is assumed from memory.

## Proposed model
**`grok-4.20-0309-non-reasoning`** (alias `grok-4.20-non-reasoning`) for every role.
- No reasoning tokens, so short replies are fast and cheap; structured outputs and server-side
  tools (web search) are supported; 1M context.
- $1.25 per 1M input tokens, $0.20 cached input, $2.50 output.
- Fallback if it misbehaves on a role: `grok-4.3` with `reasoning_effort: "none"`, same prices.
- Pin the dated ID (not the floating alias) so behaviour does not change under us.

## Cost per call (estimates from the listed prices)
| Call | Tokens (in / out) | Tool | Cost |
| --- | --- | --- | --- |
| Options in words, translator, honor nudge, recap | ~1,500 / ~150 | none | about $0.0023 |
| Question finder (catalogue excerpt in context) | ~4,000 / ~250 | none | about $0.0056 |
| Move explainer with web search | ~6,000 / ~150 (search results count as input) | 1 web_search call ($5 per 1,000) | about $0.013 |
| Same with X search | as above | $5 per 1,000 posts fetched + $10 per 1,000 profiles | about $0.06 for 10 posts |
| Practice-opponent decision | ~1,000 / ~60 | none | about $0.0014 |

With the limits below, a busy demo day stays under the proposed $3 daily cap.

## Endpoint, auth, streaming
- Base URL `https://api.x.ai/v1`; header `Authorization: Bearer $XAI_API_KEY`.
- Use the **Responses API** (`POST /v1/responses`, xAI's recommended path; Chat Completions is the
  older OpenAI-compatible one). Works with the OpenAI SDK pointed at the base URL, or with
  `@ai-sdk/xai`; I propose plain `fetch` from our server (no new dependency).
- Streaming over server-sent events (`response.output_text.delta`, `response.completed`).
- Send `store: false` (the Responses API otherwise keeps conversation state for 30 days).
- Each response reports its cost (`cost_in_usd_ticks`, 10^10 ticks = $1): the daily cap can count
  real spend, not estimates.

## Live web and X search
- Available as **server-side tools** in the Responses API: `web_search` (optional allowed/excluded
  domains, up to 5) and `x_search` (optional allowed/excluded handles, date range). Citations come
  back as `url_citation` annotations and a `citations` list; inline `[[N]](url)` markers can be
  switched off with `include: ["no_inline_citations"]`.
- The older Live Search (`search_parameters` on Chat Completions) is still documented without a
  deprecation notice, but the guide URL now serves the Web Search tool page: use the tools.
- Proposal: web search only for the move explainer, limited to a short list of sports and news
  domains when the market is sports; X search off by default (it is billed per post fetched) and
  switchable later with a small cap (`max_turns: 1`, a handful of posts).

## Structured output
- Responses API: `text: { format: { type: "json_schema", name, schema, strict: true } }`. With
  supported schema features the reply is guaranteed to match; it also works together with tools.
- Supported: string, number, integer, boolean, null, enum, const, arrays, objects, anyOf/oneOf,
  `$ref`; `additionalProperties` defaults to false. Strings up to 2,048 characters, arrays up to 256.
- Our use: every proposing role (translator, question finder, practice opponent) gets a strict
  schema; the server still validates against the pot's rules, and on invalid output retries once,
  then falls back to a template sentence.

## Rules this design adds
- **Numbers.** Grok receives named placeholders (`{share_now}`, `{fee}`, `{exit_estimate}`) and
  writes sentences around them; our code fills them in. The output check rejects any digit that is
  not part of a placeholder or of the supplied context.
- **Advice check.** The system prompt forbids recommending a side or an exit; the output check
  rejects phrases like "you should", "I recommend", "take the", "leave now", "buy", "sell"; a
  rejected reply falls back to the template.
- **Untrusted text.** Search results only ever reach Grok inside a delimited data block, never as
  instructions, and no role that sees fetched text has an action schema.

## Proposed limits
- Unprompted bubbles: at most one every 5 minutes per player, at most 3 per pot, none during an
  exit window; muted for good with one tap (remembered).
- Ask box: 20 questions per player per hour.
- Move explainer: triggered by a move of 5 points or more within a minute; one call per market per
  3 minutes, shared by every viewer.
- Practice opponent: one decision per pot per 30 s, practice pots up to $2 only.
- Spending: $3 per day across everything (counted from `cost_in_usd_ticks`), shown on /status;
  GrokCat sleeps for the rest of the day when it is reached.

## Accounts and data
- A new xAI account is Tier 0: 37 requests per second and 10M tokens per minute on this model,
  far above our needs. No free credits are mentioned: the account needs prepaid credits. Even $5
  covers many days at the limits above; it is your call, as it is real money.
- xAI does not train on API data and deletes requests after 30 days (encrypted at rest).
- We log each call's role, latency, outcome and cost only; no player text is stored.

## Where to put the key
- Locally: `.env` as `XAI_API_KEY=` (placeholder added to `.env.example`).
- Vercel: project **verdict** → Settings → Environment Variables → add `XAI_API_KEY` for
  **Production** (and Preview if you want it there), type **Sensitive**. Never with a
  `NEXT_PUBLIC_` prefix. Or tell me once it is in `.env` and I add it to Vercel without printing it.
