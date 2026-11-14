import { Card } from "@/components/ui";

export const metadata = { title: "Developers · Verdict" };

const steps: { title: string; body: string; code: string }[] = [
  {
    title: "1. Get an API key",
    body: "An operator creates an integration with the admin token. The API key and webhook secret are shown once.",
    code: `curl -X POST $VERDICT/api/admin/integrations \\
  -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \\
  -d '{"name":"my-app","webhookUrl":"https://my-app.example/verdict"}'
# -> { "apiKey": "vk_…", "webhookSecret": "whsec_…", "integration": { "id": … } }`,
  },
  {
    title: "2. Register a condition your app will decide",
    body: "Source \"api\" means only your integration can report its outcome. The conditionId is keccak256(\"api:<key>\").",
    code: `curl -X POST $VERDICT/api/v1/conditions -H "authorization: Bearer $VK" \\
  -H "content-type: application/json" \\
  -d '{"source":"api","key":"order-1042","label":"Order 1042 delivered"}'
# -> { "conditionId": "0x…", "owner": "<your integration id>" }`,
  },
  {
    title: "3. Lock USDC in a pot — the payer only signs",
    body:
      "Ask the relay for the Arc USDC ReceiveWithAuthorization (EIP-3009) typed data, have the payer sign it with any wallet, " +
      "and submit. The relay creates and funds the pot in one transaction and pays gas in USDC. The nonce is bound to the " +
      "pot terms, so the signature cannot be reused or redirected.",
    code: `POST /api/gasless/prepare  { kind: "create", from, amount, params: { conditionId, resolver, payees, sharesBps, refundTo, deadline } }
# -> { typedData, salt, validAfter, validBefore }      (sign typedData with eth_signTypedData_v4)
POST /api/gasless/create   { params, amount, authorization: { from, validAfter, validBefore, salt, signature } }
# -> { tx, potId }
# top-ups: same flow with kind "fund" + POST /api/gasless/fund`,
  },
  {
    title: "4. Report the outcome",
    body: "Final and idempotent: repeating the same outcome is fine, changing it returns 409. The relay signs an EIP-712 resolution and settles on-chain.",
    code: `curl -X POST $VERDICT/api/v1/outcomes -H "authorization: Bearer $VK" \\
  -H "content-type: application/json" -d '{"conditionId":"0x…","outcome":true}'`,
  },
  {
    title: "5. React to webhooks",
    body:
      "Events: pot.created, pot.funded, pot.resolved, pot.expired, payment.payout, payment.refund, payment.deferred, ping. " +
      "At-least-once delivery with exponential backoff; dedupe on Verdict-Event-Id.",
    code: `// Verdict-Signature: t=<unix>,v1=<hex HMAC-SHA256(webhookSecret, t + "." + rawBody)>
import { verifyWebhook } from "@verdict/sdk";
if (!(await verifyWebhook(process.env.VERDICT_WEBHOOK_SECRET, req.headers["verdict-signature"], rawBody))) return 401;`,
  },
];

const endpoints: [string, string, string][] = [
  ["GET", "/api/v1/me", "integration, vault, resolver, chain"],
  ["POST", "/api/v1/conditions", "register a condition (api, manual, gemini, http)"],
  ["POST", "/api/v1/outcomes", "report the outcome of your api condition"],
  ["GET", "/api/v1/pots?conditionId=", "pots for a condition"],
  ["GET", "/api/v1/pots/:id", "pot, events, payments, relay cost"],
  ["GET", "/api/v1/deliveries", "webhook delivery log"],
  ["POST", "/api/v1/webhooks/test", "send a signed ping"],
  ["POST", "/api/gasless/prepare", "typed data to sign (create or fund)"],
  ["POST", "/api/gasless/create", "relay-submitted create + fund"],
  ["POST", "/api/gasless/fund", "relay-submitted top-up"],
  ["GET", "/api/pots, /api/payments, /api/status", "public read models and relay status"],
];

const sources: [string, string][] = [
  ["api", "your backend reports the outcome (API key, owner-only, immutable)"],
  ["manual", "operator sets it with the admin token (demos, tests)"],
  ["gemini", "Gemini prediction market contract settles Yes/No — key EVENT:CONTRACT"],
  ["http", 'any public JSON API — key {"url","path","yes","no"}, https only, SSRF-guarded'],
];

export default function DevelopersPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Build on Verdict</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Verdict holds USDC on Arc testnet and pays it out or refunds it when an outcome is reported. Your app decides what the
          condition means; the vault, relay, gas and indexing are handled here. Everything below works against this deployment.
        </p>
      </div>

      <div className="space-y-4">
        {steps.map((s) => (
          <Card key={s.title} title={s.title}>
            <p className="text-sm text-muted">{s.body}</p>
            <pre className="mt-3 overflow-x-auto rounded-md bg-background p-3 font-mono text-xs leading-relaxed">{s.code}</pre>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Endpoints">
          <table className="w-full text-sm">
            <tbody>
              {endpoints.map(([m, path, what]) => (
                <tr key={path} className="border-t border-border first:border-0">
                  <td className="py-1.5 pr-2 font-mono text-xs text-muted">{m}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{path}</td>
                  <td className="py-1.5 text-xs text-muted">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Result sources">
          <ul className="space-y-2 text-sm">
            {sources.map(([name, what]) => (
              <li key={name}>
                <span className="font-mono text-xs">{name}</span> <span className="text-muted">— {what}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Trust-minimised resolution: deploy a <span className="font-mono">MultisigResolver</span> (M-of-N, ERC-1271) and use its
            address as a pot&apos;s resolver; the vault verifies it via SignatureChecker.
          </p>
        </Card>
      </div>
    </div>
  );
}
