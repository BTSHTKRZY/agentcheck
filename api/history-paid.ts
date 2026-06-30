import type { VercelRequest, VercelResponse } from "@vercel/node";
// NOTE: @opensea/tool-sdk and zod/v4 are ES Modules. This file compiles as
// CommonJS on Vercel, so we cannot `import` them at the top level (that emits a
// require() and crashes with ERR_REQUIRE_ESM). Instead we load them via dynamic
// import() inside an async builder, which works from CommonJS.

// ── PAID SCORE-HISTORY ENDPOINT (x402-metered, registry-reported) ─────────────
// First metered AgentCheck endpoint. Chosen because it is FAST (a Redis read),
// so it settles cleanly under the SDK's blocking-settlement model — no timeout
// risk. Routes through createToolHandler so:
//   • payaiX402Gate collects $0.20 USDC per call, and
//   • usageReporting reports each paid call to the ERC-8257 registry under
//     Tool #13 (this is what makes the registry COUNT the calls → featuring).
//
// The free tier is untouched: /api/check (current rating) and /api/history
// (last 10 points) stay free. THIS endpoint returns the FULL trajectory +
// analytics — the premium depth on top of the free snapshot.

const PAYOUT_ADDRESS = "0x020d6409Ebc4fa13E754e0fEa275ac353eFD4f03";
const PRICE_USDC     = "0.02";

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

// ── LAZY BUILDER (dynamic import of the ESM SDK) ────────────────────────────
let _handlerPromise: Promise<(req: Request) => Promise<Response>> | null = null;

async function getToolHandler(): Promise<(req: Request) => Promise<Response>> {
  if (_handlerPromise) return _handlerPromise;
  _handlerPromise = (async () => {
    const { z } = await import('zod/v4');
    const { createToolHandler, defineManifest, payaiX402Gate, x402UsdcPricing } = await import('@opensea/tool-sdk');

    // ── MANIFEST ──────────────────────────────────────────────────────────────────
    const manifest = defineManifest({
      type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
      name: "agentcheck-score-history",
      description:
        "Full trust-score trajectory for any wallet: every recorded rating over time, " +
        "trend direction, volatility, and high/low band. The free AgentCheck check gives " +
        "the current rating; this gives the history and direction.",
      endpoint: "https://agentcheck-bice.vercel.app/api/history-paid",
      inputs: {
        type: "object",
        properties: {
          wallet: { type: "string", description: "Wallet address (0x...)" },
        },
        required: ["wallet"],
      },
      outputs: {
        type: "object",
        properties: {
          wallet:     { type: "string" },
          trajectory: { type: "string" },
          points:     { type: "array" },
        },
      },
      version: "1.0.0",
      pricing: x402UsdcPricing({ recipient: PAYOUT_ADDRESS, amountUsdc: PRICE_USDC }),
      creatorAddress: PAYOUT_ADDRESS.toLowerCase(),
      tags: ["wallet", "trust", "reputation", "history", "agentcheck"],
    });

    // ── SCHEMAS ───────────────────────────────────────────────────────────────────
    const inputSchema = z.object({
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Valid 0x wallet address required"),
    });

    const outputSchema = z.object({
      wallet:        z.string(),
      trajectory:    z.string(),
      points_total:  z.number(),
      points:        z.array(z.object({
        composite: z.number(),
        rating:    z.string(),
        at:        z.string().nullable(),
      })),
      analytics: z.object({
        current:    z.number().nullable(),
        high:       z.number().nullable(),
        low:        z.number().nullable(),
        average:    z.number().nullable(),
        volatility: z.number().nullable(),
        first_seen: z.string().nullable(),
      }),
    });

    // ── GATE ──────────────────────────────────────────────────────────────────────
    const x402 = payaiX402Gate({ recipient: PAYOUT_ADDRESS, amountUsdc: PRICE_USDC });

    // ── DATA ──────────────────────────────────────────────────────────────────────
    async function getScoreHistory(wallet: string): Promise<Array<{ c: number; r: string; t: number }>> {
      try {
        const res = await fetch(
          `${REDIS_URL}/lrange/${encodeURIComponent("agentcheck:score_history:" + wallet)}/0/29`,
          { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } }
        );
        const data = await res.json() as any;
        const arr  = Array.isArray(data?.result) ? data.result : [];
        const out: Array<{ c: number; r: string; t: number }> = [];
        for (const s of arr) {
          try {
            let v: any = JSON.parse(s);
            if (typeof v === "string") v = JSON.parse(v);
            const t = typeof v?.t === "number" ? v.t : parseInt(v?.t, 10);
            if (Number.isFinite(t) && typeof v?.c === "number") out.push({ c: v.c, r: v.r || "", t });
          } catch {}
        }
        return out;
      } catch { return []; }
    }

    // ── TOOL HANDLER (gated + reported) ───────────────────────────────────────────
    const toolHandler = createToolHandler({
      manifest,
      inputSchema,
      outputSchema,
      gates: [x402],
      handler: async (input: { wallet: string }) => {
        const wallet = input.wallet.toLowerCase();
        const raw = await getScoreHistory(wallet);                 // most-recent-first
        const chrono = [...raw].reverse();                          // chronological

        const composites = chrono.map((p) => p.c);
        const current = composites.length ? composites[composites.length - 1] : null;
        const high    = composites.length ? Math.max(...composites) : null;
        const low     = composites.length ? Math.min(...composites) : null;
        const average = composites.length
          ? Math.round(composites.reduce((s, n) => s + n, 0) / composites.length)
          : null;
        // population standard deviation as a simple volatility measure
        const volatility = composites.length > 1 && average !== null
          ? Math.round(Math.sqrt(composites.reduce((s, n) => s + (n - average) ** 2, 0) / composites.length) * 10) / 10
          : null;

        const trajectory =
          composites.length < 2 ? "insufficient_history" :
          (composites[composites.length - 1] - composites[0]) > 5 ? "improving" :
          (composites[composites.length - 1] - composites[0]) < -5 ? "declining" : "stable";

        return {
          wallet,
          trajectory,
          points_total: chrono.length,
          points: chrono.map((p) => ({
            composite: p.c,
            rating:    p.r,
            at:        Number.isFinite(p.t) ? new Date(p.t).toISOString() : null,
          })),
          analytics: {
            current, high, low, average, volatility,
            first_seen: chrono.length && Number.isFinite(chrono[0].t)
              ? new Date(chrono[0].t).toISOString() : null,
          },
        };
      },
      // ── REGISTRY USAGE REPORTING — this is what makes the registry count calls ──
      usageReporting: {
        chainId: 8453,                 // Base — EIP-712 USDC domain / x402
        toolChainId: 8453,             // ERC-8257: tool registered on Base
        toolRegistryAddress: "0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1",
        toolOnchainId: 13,             // AgentCheck = Tool #13
        apiKey: process.env.OPENSEA_API_KEY!,
      },
    });


    return toolHandler as (req: Request) => Promise<Response>;
  })();
  return _handlerPromise;
}

// ── VERCEL ADAPTER ────────────────────────────────────────────────────────────
// createToolHandler returns a Web Request/Response handler. Vercel's Node
// runtime passes (req, res), so we bridge: build a Web Request from the Vercel
// req, invoke the tool handler, and pipe the Web Response back out.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET — advertise metadata + price without requiring payment.
  if (req.method === "GET") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      tool: "AgentCheck Score History (paid)",
      price: `${PRICE_USDC} USDC per lookup`,
      free_alternative: "Current rating is free at /api/check; last 10 points free at /api/history.",
      returns: "Full trajectory, trend, high/low/average, volatility, first-seen.",
      how_to_call: "POST { wallet } with an X-Payment header (x402). 402 challenge returned if unpaid.",
      manifest: "/.well-known/ai-tool/agentcheck-score-history.json",
    });
  }

  // Build a Web Request from the incoming Vercel request.
  const url = `https://${req.headers.host}${req.url}`;
  const body = req.method === "POST"
    ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}))
    : undefined;

  const webReq = new Request(url, {
    method: req.method,
    headers: req.headers as any,
    body,
  });

  const toolHandler = await getToolHandler();
  const webRes: Response = await toolHandler(webReq);

  // Pipe the Web Response back through Vercel's res.
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  res.setHeader("Access-Control-Allow-Origin", "*");
  const text = await webRes.text();
  res.status(webRes.status);
  try { return res.json(JSON.parse(text)); }
  catch { return res.send(text); }
}
