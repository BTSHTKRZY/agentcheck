import type { VercelRequest, VercelResponse } from "@vercel/node";

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

async function redisGet(key: string): Promise<string | null> {
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const d = await r.json() as any;
    return d?.result ?? null;
  } catch { return null; }
}

async function redisKeys(pattern: string): Promise<string[]> {
  try {
    const r = await fetch(`${REDIS_URL}/keys/${encodeURIComponent(pattern)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const d = await r.json() as any;
    return Array.isArray(d?.result) ? d.result : [];
  } catch { return []; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Optional HTML view: /api/stats?format=html
  const wantHtml = (req.query?.format || "").toString() === "html";

  try {
    const [
      totalChecks,
      historyKeys,
      ratingAAA, ratingAA, ratingA, ratingBBB, ratingBB,
      ratingB, ratingCCC, ratingCC, ratingC, ratingD,
      callsHuman, callsAgent, callsUnknown, callsTest, callsInternal,
      certLogLen,
    ] = await Promise.all([
      redisGet("agentcheck:total_checks"),
      redisKeys("agentcheck:history:*"),
      redisGet("agentcheck:rating:AAA"),
      redisGet("agentcheck:rating:AA"),
      redisGet("agentcheck:rating:A"),
      redisGet("agentcheck:rating:BBB"),
      redisGet("agentcheck:rating:BB"),
      redisGet("agentcheck:rating:B"),
      redisGet("agentcheck:rating:CCC"),
      redisGet("agentcheck:rating:CC"),
      redisGet("agentcheck:rating:C"),
      redisGet("agentcheck:rating:D"),
      redisGet("agentcheck:calls:human"),
      redisGet("agentcheck:calls:agent"),
      redisGet("agentcheck:calls:unknown"),
      redisGet("agentcheck:calls:test"),
      redisGet("agentcheck:calls:internal"),
      (async () => {
        try {
          const r = await fetch(`${REDIS_URL}/llen/agentcheck:cert_log`, {
            headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
          });
          const d = await r.json() as any;
          return d?.result ?? 0;
        } catch { return 0; }
      })(),
    ]);

    const n = (v: any) => parseInt(v || "0", 10) || 0;

    const ratingDistribution = {
      AAA: n(ratingAAA), AA: n(ratingAA), A: n(ratingA),
      BBB: n(ratingBBB), BB: n(ratingBB), B: n(ratingB),
      CCC: n(ratingCCC), CC: n(ratingCC), C: n(ratingC), D: n(ratingD),
    };

    const sourceBreakdown = {
      human:    n(callsHuman),
      agent:    n(callsAgent),
      unknown:  n(callsUnknown),
      test:     n(callsTest),
      internal: n(callsInternal),
    };

    const stats = {
      total_checks:        n(totalChecks),
      unique_wallets:      historyKeys.length,
      certifications_run:  typeof certLogLen === "number" ? certLogLen : n(certLogLen),
      rating_distribution: ratingDistribution,
      source_breakdown:    sourceBreakdown,
      registry: {
        tool_id:           13,
        registry:          "ERC-8257 Agent Tool Registry",
        network:           "Base",
        cert_registry:     "0x803A8988E40CBb54897e5782A6A589d907A5B03A",
        access_predicate:  "0x4738Db02a82Fb745460E86D568D387ef95b3eB18",
      },
      certification: {
        battery_version: "1.2",
        scoring:         "LLM-as-judge (semantic, not keyword matching)",
        suites:          ["prompt_injection", "secret_protection", "unsafe_action", "indirect_injection"],
        differentiator:  "indirect/tool-output injection + multi-turn attacks — not tested by reputation-only scorers",
      },
      generated_at: new Date().toISOString(),
      note: "Live counters. Unique wallets = distinct addresses checked. Rating distribution accumulates from the moment per-rating counters were deployed.",
    };

    if (!wantHtml) {
      return res.status(200).json(stats);
    }

    // ── HTML VIEW ──────────────────────────────────────────────────────────────
    const maxRating = Math.max(1, ...Object.values(ratingDistribution));
    const bar = (label: string, val: number, color: string) => `
      <div class="row">
        <span class="rk">${label}</span>
        <div class="track"><div class="fill" style="width:${(val / maxRating) * 100}%;background:${color};"></div></div>
        <span class="rv">${val}</span>
      </div>`;

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AgentCheck — Live Stats</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#07070D;color:#e2e8f0;font-family:'Inter',sans-serif;padding:48px 24px 80px;}
.wrap{max-width:680px;margin:0 auto;}
.tag{font-size:10px;letter-spacing:.24em;color:#6366f1;font-family:'Space Mono',monospace;margin-bottom:8px;}
h1{font-size:28px;font-weight:600;margin-bottom:32px;}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:32px;}
.stat{background:#0f0f1a;border:1px solid #1e1e3a;border-radius:10px;padding:20px;}
.stat .num{font-size:32px;font-weight:700;font-family:'Space Mono',monospace;color:#fff;}
.stat .lbl{font-size:12px;color:#94a3b8;margin-top:4px;}
h2{font-size:13px;font-family:'Space Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:28px 0 14px;}
.card{background:#0f0f1a;border:1px solid #1e1e3a;border-radius:10px;padding:20px 24px;}
.row{display:flex;align-items:center;gap:12px;padding:5px 0;}
.rk{font-family:'Space Mono',monospace;font-size:13px;min-width:42px;color:#e2e8f0;}
.track{flex:1;height:8px;background:#0a0a1a;border-radius:4px;overflow:hidden;}
.fill{height:100%;border-radius:4px;}
.rv{font-family:'Space Mono',monospace;font-size:13px;color:#94a3b8;min-width:32px;text-align:right;}
.src{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e1e3a;font-size:14px;}
.src:last-child{border:none;}
.foot{margin-top:32px;font-size:12px;color:#4a5568;font-family:'Space Mono',monospace;text-align:center;}
a{color:#6366f1;text-decoration:none;}
</style></head><body><div class="wrap">
<div class="tag">AGENTCHECK · ERC-8257 TOOL #13 · BASE</div>
<h1>Live Stats</h1>
<div class="grid">
  <div class="stat"><div class="num">${stats.total_checks}</div><div class="lbl">total checks</div></div>
  <div class="stat"><div class="num">${stats.unique_wallets}</div><div class="lbl">unique wallets</div></div>
  <div class="stat"><div class="num">${stats.certifications_run}</div><div class="lbl">certifications</div></div>
</div>
<h2>Rating Distribution</h2>
<div class="card">
  ${bar("AAA", ratingDistribution.AAA, "#22c55e")}
  ${bar("AA", ratingDistribution.AA, "#22c55e")}
  ${bar("A", ratingDistribution.A, "#4ade80")}
  ${bar("BBB", ratingDistribution.BBB, "#eab308")}
  ${bar("BB", ratingDistribution.BB, "#eab308")}
  ${bar("B", ratingDistribution.B, "#f97316")}
  ${bar("CCC", ratingDistribution.CCC, "#f97316")}
  ${bar("CC", ratingDistribution.CC, "#ef4444")}
  ${bar("C", ratingDistribution.C, "#ef4444")}
  ${bar("D", ratingDistribution.D, "#ef4444")}
</div>
<h2>Who's Calling</h2>
<div class="card">
  <div class="src"><span>Agents (self-declared)</span><span>${sourceBreakdown.agent}</span></div>
  <div class="src"><span>Humans</span><span>${sourceBreakdown.human}</span></div>
  <div class="src"><span>Unattributed</span><span>${sourceBreakdown.unknown}</span></div>
  <div class="src"><span>Tests</span><span>${sourceBreakdown.test}</span></div>
</div>
<div class="foot">
  Tool #13 · ERC-8257 · Base · <a href="https://agentcheck-bice.vercel.app/api/methodology">methodology</a><br/>
  ${stats.generated_at}
</div>
</div></body></html>`;

    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
