/**
 * The one Gemini order-book reader. Everything that looks at a prediction market's book (the
 * samplers, the market catalogue, live quotes, pot creation checks) goes through here.
 *
 * Two public sources, documented at developer.gemini.com:
 * - REST `GET /v1/book/{symbol}`: one request, any depth (`limit_bids`, `limit_asks`, 0 = all).
 * - WebSocket `wss://ws.gemini.com`, stream `{symbol}@depth5`: the top five levels per side,
 *   a full snapshot about once a second, many symbols on one connection, no REST budget used.
 */

export const GEMINI_REST = process.env.GEMINI_API_BASE ?? "https://api.gemini.com";
export const GEMINI_WS = "wss://ws.gemini.com";

export type RawLevel = { price: string; amount: string };
export type RawBook = { bids: RawLevel[]; asks: RawLevel[] };

/** Order book over REST; `levels` 0 = every level. Null on any error (404, 429, timeout, bad JSON). */
export async function readBook(symbol: string, opts: { levels?: number; timeoutMs?: number } = {}): Promise<RawBook | null> {
  const n = opts.levels ?? 0;
  try {
    const r = await fetch(`${GEMINI_REST}/v1/book/${encodeURIComponent(symbol)}?limit_bids=${n}&limit_asks=${n}`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = JSON.parse(await r.text()) as Partial<RawBook>;
    return { bids: j.bids ?? [], asks: j.asks ?? [] };
  } catch {
    return null;
  }
}

/**
 * A long-lived `{symbol}@depth5` subscription with reconnects. `watch` sets the wanted symbols
 * (subscribing and unsubscribing the difference); `latest` returns the last snapshot received.
 */
export class DepthStream {
  private ws: WebSocket | null = null;
  private readonly books = new Map<string, { recv: number; book: RawBook }>();
  private wanted = new Set<string>();
  private subscribed = new Set<string>();
  private closed = false;
  private id = 1;
  private onUpdate: ((symbol: string) => void) | null = null;

  constructor(private readonly url = GEMINI_WS) {}

  private connect() {
    if (this.closed || this.ws) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.subscribed.clear();
    ws.onopen = () => this.sync();
    ws.onmessage = (m) => {
      try {
        const j = JSON.parse(String(m.data)) as { symbol?: string; bids?: [string, string][]; asks?: [string, string][] };
        if (!j.symbol) return;
        const key = j.symbol.toLowerCase();
        this.books.set(key, {
          recv: Date.now(),
          book: { bids: (j.bids ?? []).map(([price, amount]) => ({ price, amount })), asks: (j.asks ?? []).map(([price, amount]) => ({ price, amount })) },
        });
        this.onUpdate?.(key);
      } catch {
        /* ignore non-JSON frames */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (!this.closed) setTimeout(() => this.connect(), 2000);
    };
    ws.onerror = () => ws.close();
  }

  private sync() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const add = [...this.wanted].filter((s) => !this.subscribed.has(s));
    const drop = [...this.subscribed].filter((s) => !this.wanted.has(s));
    // Gemini accepts a list per SUBSCRIBE; keep each message to 50 streams.
    for (let i = 0; i < add.length; i += 50)
      ws.send(JSON.stringify({ id: String(this.id++), method: "SUBSCRIBE", params: add.slice(i, i + 50).map((s) => `${s}@depth5`) }));
    for (let i = 0; i < drop.length; i += 50)
      ws.send(JSON.stringify({ id: String(this.id++), method: "UNSUBSCRIBE", params: drop.slice(i, i + 50).map((s) => `${s}@depth5`) }));
    add.forEach((s) => this.subscribed.add(s));
    drop.forEach((s) => {
      this.subscribed.delete(s);
      this.books.delete(s.toLowerCase());
    });
  }

  watch(symbols: string[]) {
    this.wanted = new Set(symbols);
    if (!this.ws) this.connect();
    else this.sync();
  }

  latest(symbol: string) {
    return this.books.get(symbol.toLowerCase()) ?? null;
  }

  /** Resolves when every given symbol has a snapshot, or after `ms`. */
  async until(symbols: string[], ms: number) {
    const missing = new Set(symbols.map((s) => s.toLowerCase()).filter((s) => !this.books.has(s)));
    if (!missing.size) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.onUpdate = (key) => {
        missing.delete(key);
        if (!missing.size) done();
      };
    });
    this.onUpdate = null;
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

/** One batch read: the top five levels of many symbols at once, waiting at most `ms`. */
export async function depthSnapshot(symbols: string[], ms: number): Promise<Map<string, RawBook>> {
  const out = new Map<string, RawBook>();
  if (!symbols.length) return out;
  const s = new DepthStream();
  try {
    s.watch(symbols);
    await s.until(symbols, ms);
    for (const sym of symbols) {
      const b = s.latest(sym);
      if (b) out.set(sym, b.book);
    }
  } finally {
    s.close();
  }
  return out;
}

export type MarketState = { status: string; marketState: string | null; resolutionSide: "yes" | "no" | null; at: number };

/** A contract's status from the public events endpoint (open, halted, under review, settled). */
export async function fetchMarketState(eventTicker: string, contractTicker: string): Promise<MarketState | null> {
  try {
    const r = await fetch(`${GEMINI_REST}/v1/prediction-markets/events/${encodeURIComponent(eventTicker)}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const e = (await r.json()) as { status: string; contracts: { ticker: string; status: string; marketState?: string | null; resolutionSide?: "yes" | "no" | null }[] };
    const c = e.contracts.find((x) => x.ticker === contractTicker);
    if (!c) return null;
    return { status: c.status, marketState: c.marketState ?? null, resolutionSide: c.resolutionSide ?? null, at: Date.now() };
  } catch {
    return null;
  }
}
