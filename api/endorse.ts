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

  const { endorser, endorsed, context, signature } = req.body;

  if (!endorser || !endorsed) {
    return res.status(400).json({ error: "endorser and endorsed wallet addresses required" });
  }

  if (endorser.toLowerCase() === endorsed.toLowerCase()) {
    return res.status(400).json({ error: "Cannot endorse yourself" });
  }

  try {
    const key = `agentcheck:endorsements:${endorsed.toLowerCase()}`;
    const existing: any = await redis.get(key).catch(() => null);

    const current = existing || { count: 0, list: [] };

    // Check if this endorser has already endorsed this wallet
    const alreadyEndorsed = current.list.some(
      (e: any) => e.endorser.toLowerCase() === endorser.toLowerCase()
    );

    if (alreadyEndorsed) {
      return res.status(409).json({
        error: "This endorser has already endorsed this wallet",
        current_endorsements: current.count,
      });
    }

    // Add endorsement
    current.list.push({
      endorser:  endorser.toLowerCase(),
      context:   context || "general",
      signature: signature || null,
      ts:        Date.now(),
    });
    current.count = current.list.length;

    await redis.set(key, current);

    // Also log in global endorsement feed
    await redis.lpush("agentcheck:endorsement_feed", JSON.stringify({
      endorser:  endorser.toLowerCase(),
      endorsed:  endorsed.toLowerCase(),
      context:   context || "general",
      ts:        Date.now(),
    }));
    await redis.ltrim("agentcheck:endorsement_feed", 0, 999);

    return res.status(200).json({
      ok: true,
      endorsed:             endorsed.toLowerCase(),
      total_endorsements:   current.count,
      message:              `Endorsement recorded. ${endorsed} now has ${current.count} endorsement${current.count === 1 ? "" : "s"}.`,
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
