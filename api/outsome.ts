import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const {
    wallet,
    reporter,
    outcome,
    tx_hash,
    value_eth,
    context,
  } = req.body;

  if (!wallet || !reporter || !outcome) {
    return res.status(400).json({
      error: "wallet, reporter, and outcome required. outcome must be: positive, negative, or neutral",
    });
  }

  if (!["positive", "negative", "neutral"].includes(outcome)) {
    return res.status(400).json({
      error: "outcome must be: positive, negative, or neutral",
    });
  }

  try {
    const key = `agentcheck:outcomes:${wallet.toLowerCase()}`;
    const existing: any = await redis.get(key).catch(() => null);

    const current = existing || { total: 0, positive: 0, negative: 0, neutral: 0, records: [] };

    // Add outcome record
    current.total    += 1;
    current[outcome] += 1;
    current.records.push({
      reporter:  reporter.toLowerCase(),
      outcome,
      tx_hash:   tx_hash   || null,
      value_eth: value_eth || null,
      context:   context   || null,
      ts:        Date.now(),
    });

    // Keep last 200 records
    if (current.records.length > 200) {
      current.records = current.records.slice(-200);
    }

    await redis.set(key, current);

    // Global outcome feed — powers model calibration over time
    await redis.lpush("agentcheck:outcome_feed", JSON.stringify({
      wallet:    wallet.toLowerCase(),
      reporter:  reporter.toLowerCase(),
      outcome,
      tx_hash:   tx_hash   || null,
      value_eth: value_eth || null,
      ts:        Date.now(),
    }));
    await redis.ltrim("agentcheck:outcome_feed", 0, 9999);

    // Increment global counters
    await redis.incr(`agentcheck:outcomes_total`);
    await redis.incr(`agentcheck:outcomes_${outcome}`);

    const positiveRate = current.total > 0
      ? Math.round((current.positive / current.total) * 100)
      : 0;

    return res.status(200).json({
      ok: true,
      wallet:         wallet.toLowerCase(),
      outcome_recorded: outcome,
      total_outcomes: current.total,
      positive:       current.positive,
      negative:       current.negative,
      neutral:        current.neutral,
      positive_rate:  `${positiveRate}%`,
      message:        `Outcome recorded. This data improves AgentCheck scoring accuracy over time.`,
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
