# Grok Bot: what xAI's docs say (checked 2026-11-18)

Read on docs.x.ai/grok-bot only; nothing below comes from memory or third-party guides. The feature
we build on it is called **Grok Catbot** in HonorCat (the owner's name for it, 2026-11-18).

## 1. Custom remote MCP connector

- **Auth:** the custom connector form ("Connect apps", "Add a custom connector", type "Remote HTTPS")
  takes a Server URL, optional **HTTP headers**, and optional **OAuth** (Client ID, then Client
  Secret). OAuth tokens stay on the connector backend; the Bot never sees them.
  [computer-and-apps](https://docs.x.ai/grok-bot/computer-and-apps)
- **Approvals:** Auto Review is on by default and checks each action before the Bot "uses a
  connected app"; "most actions run on their own". When one needs approval, the card offers
  "Allow once", "Always allow" (saves a rule) or "Deny". "Ask first" rules always ask. Individual
  app tools can be switched on or off. [approvals-security-and-privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy),
  [settings-and-notifications](https://docs.x.ai/grok-bot/settings-and-notifications)
- **Not stated:** transport (streamable HTTP or SSE), whether a token in the URL is fine, whether
  approval is per call or per tool, read versus write treatment, tool limits.

**Our connector against this:** `/api/mcp` takes `Authorization: Bearer <seat token>` (fits the
"HTTP headers" field), and `/api/mcp/<seat token>` puts the token in the URL (fits a bare Server
URL). No OAuth. Because Auto Review may let calls run without asking, the seat's signed powers and
limits are the real guard: the server must refuse anything outside them, whatever the Bot does.

## 2. Webhook trigger on a routine

- Ask the Bot to add a webhook trigger; on desktop the routine's Webhook section shows "POST to"
  (the URL), "key", and the ready header `Authorization: Bearer <key>`.
- POST with an optional JSON body; "the Bot receives the body with the routine instruction".
- `200` means a run started, not finished. Anything else: no run (check the routine is not paused
  and the key is current).
- Limits: 300 runs per hour across all routines, 200 per hour per routine; over the limit the run
  fails with "Automation run rate limit exceeded" and is **not retried automatically**. Up to 50
  routines per Bot; run history keeps 20 runs. Advice: make retries idempotent.
  [skills-routines-and-automations](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- **Not stated:** the URL format, key rotation, body size limit, content type, status code on rate
  limit, how long a call may take.

**For our events:** send JSON with `Authorization: Bearer <key>`; treat only 200 as delivered; retry
with backoff on anything else (the Bot will not retry for us); keep events small and well under the
hourly limits (batch per chain when several happen at once).

## 3. Exporting a chat

- No built-in export or share link for a Bot conversation or a routine run is documented. What
  exists: phone-call transcripts ("Export transcript", US only), downloads of images and videos,
  shareable Pages (reports a Bot builds), and sharing a Bot's configuration (not its chats).
  [chat-and-collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration),
  [files-and-results](https://docs.x.ai/grok-bot/files-and-results), [bots](https://docs.x.ai/grok-bot/bots)
- **So for docs/grok-bot/:** copy the conversation by hand into Markdown, or have the Bot write a
  Page with the transcript and save its text here.
