import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const wallet = (req.query?.wallet || "").toString().toLowerCase().trim();
  const since  = parseInt((req.query?.since || "0").toString());

  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
    return res.status(400).json({ error: "Valid wallet address required" });
  }

  try {
    // Get score history from Redis
    const history: any[] = await redis.lrange(`agentcheck:history:${wallet}`, 0, 49)
      .then(items => items.map(i => typeof i === "string" ? JSON.parse(i) : i))
      .catch(() => []);

    // Get endorsements
    const endorsements: any = await redis.get(`agentcheck:endorsements:${wallet}`).catch(() => null);
    const outcomes: any     = await redis.get(`agentcheck:outcomes:${wallet}`).catch(() => null);
    const certs: any        = await redis.get(`agentcheck:certs:${wallet}`).catch(() => null);

    // Filter history to since timestamp
    const sinceMs   = since * 1000; // convert unix seconds to ms if needed
    const actualSince = since > 1700000000000 ? since : sinceMs; // handle both ms and s

    const recentHistory = since > 0
      ? history.filter(h => h.ts > actualSince)
      : history.slice(0, 10);

    // Detect changes
    const changes: string[] = [];
    if (history.length >= 2) {
      const latest = history[0];
      const previous = history[1];

      if (latest && previous) {
        const ratingDelta = latest.composite - previous.composite;
        if (Math.abs(ratingDelta) >= 5) {
          changes.push(
            `Rating changed from ${previous.rating} to ${latest.rating} ` +
            `(${ratingDelta > 0 ? "+" : ""}${ratingDelta} composite points)`
          );
        }
        if (latest.rating !== previous.rating) {
          changes.push(`Letter grade changed: ${previous.rating} → ${latest.rating}`);
        }
      }
    }

    // New endorsements since timestamp
    const endorseList = endorsements?.list || [];
    const newEndorsements = since > 0
      ? endorseList.filter((e: any) => e.ts > actualSince)
      : [];
    if (newEndorsements.length > 0) {
      changes.push(`${newEndorsements.length} new endorsement${newEndorsements.length > 1 ? "s" : ""} received`);
    }

    // New outcomes since timestamp
    const outcomeRecords = outcomes?.records || [];
    const newOutcomes = since > 0
      ? outcomeRecords.filter((o: any) => o.ts > actualSince)
      : [];
    if (newOutcomes.length > 0) {
      const pos = newOutcomes.filter((o: any) => o.outcome === "positive").length;
      const neg = newOutcomes.filter((o: any) => o.outcome === "negative").length;
      changes.push(`${newOutcomes.length} new outcome${newOutcomes.length > 1 ? "s" : ""} reported (${pos} positive, ${neg} negative)`);
    }

    // Current state
    const current = history[0] || null;

    return res.status(200).json({
      wallet,
      monitored_since:   since > 0 ? new Date(actualSince).toISOString() : null,
      checked_at:        new Date().toISOString(),

      // Current state
      current: current ? {
        rating:      current.rating,
        composite:   current.composite,
        trust_score: current.trust_score,
        risk_score:  current.risk_score,
        agent_score: current.agent_score,
        last_checked: new Date(current.ts).toISOString(),
      } : null,

      // Changes since last check
      changes_detected:  changes.length > 0,
      changes,
      new_endorsements:  newEndorsements.length,
      new_outcomes:      newOutcomes.length,

      // Score history (last 10)
      score_history: history.slice(0, 10).map(h => ({
        rating:    h.rating,
        composite: h.composite,
        ts:        new Date(h.ts).toISOString(),
      })),

      // Certification status
      certifications: {
        passed: certs || [],
        total:  (certs || []).length,
      },

      // Community
      community: {
        total_endorsements: endorsements?.count || 0,
        total_outcomes:     outcomes?.total     || 0,
        positive_outcomes:  outcomes?.positive  || 0,
      },

      // Next check suggestion
      next_check_ts: Date.now() + 300000, // suggest polling every 5 min
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
