import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sanitizeWallet } from "../lib/verify.js";

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

// Free tier returns up to this many recent points. Full history is a future
// paid tier (the data is already stored; this endpoint just gates depth).
const FREE_TIER_POINTS = 10;

async function getScoreHistory(wallet: string): Promise<Array<{ c: number; r: string; t: number }>> {
  try {
    const res = await fetch(`${REDIS_URL}/lrange/${encodeURIComponent("agentcheck:score_history:" + wallet)}/0/29`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
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
  } catch {
    return [];
  }
}

function trajectory(points: Array<{ c: number }>): string {
  if (points.length < 2) return "insufficient_history";
  const newest = points[0].c;
  const oldest = points[points.length - 1].c;
  const delta  = newest - oldest;
  if (delta > 5)  return "improving";
  if (delta < -5) return "declining";
  return "stable";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const wallet = sanitizeWallet(req.query?.wallet);
  if (!wallet) return res.status(400).json({ error: "Valid wallet address required." });

  // Stored most-recent-first. Reverse to chronological for the timeline.
  const raw = await getScoreHistory(wallet);
  const chronological = [...raw].reverse();

  const totalPoints = chronological.length;
  const tier = (req.query?.tier || "free").toString();
  // Free tier: last N points only. (Paid full-history tier hooks here later.)
  const points = tier === "free" && totalPoints > FREE_TIER_POINTS
    ? chronological.slice(-FREE_TIER_POINTS)
    : chronological;

  return res.status(200).json({
    wallet,
    points: points.map((p) => ({
      composite: p.c,
      rating:    p.r,
      at:        Number.isFinite(p.t) ? new Date(p.t).toISOString() : null,
    })),
    trajectory:    trajectory(raw),
    points_shown:  points.length,
    points_total:  totalPoints,
    truncated:     totalPoints > points.length,
    tier,
    note: totalPoints === 0
      ? "No history yet. Each /api/check on this wallet records a point going forward."
      : totalPoints > points.length
      ? `Showing the ${points.length} most recent points. Full ${totalPoints}-point history available via the full-history tier.`
      : "Complete recorded history for this wallet.",
  });
}
