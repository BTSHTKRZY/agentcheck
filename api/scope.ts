import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — retrieve declared scope for a wallet
  if (req.method === "GET") {
    const wallet = (req.query?.wallet || "").toString().toLowerCase().trim();
    if (!wallet || !wallet.startsWith("0x")) {
      return res.status(400).json({ error: "Valid wallet address required" });
    }
    try {
      const scope: any = await redis.get(`agentcheck:scope:${wallet}`);
      if (!scope) {
        return res.status(200).json({
          wallet,
          declared: false,
          note: "No permission scope declared for this agent.",
        });
      }
      return res.status(200).json({ wallet, declared: true, ...scope });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — declare or update scope
  if (req.method === "POST") {
    const {
      wallet,
      max_transaction_eth,
      allowed_asset_classes,
      requires_approval_above_eth,
      operating_hours,
      jurisdiction,
      allowed_protocols,
      prohibited_actions,
      human_override_wallet,
      signature,
    } = req.body;

    if (!wallet || !wallet.startsWith("0x")) {
      return res.status(400).json({ error: "Valid wallet address required" });
    }

    try {
      const scope = {
        wallet:                     wallet.toLowerCase(),
        max_transaction_eth:        max_transaction_eth        || null,
        allowed_asset_classes:      allowed_asset_classes      || ["ETH", "ERC-20", "ERC-721"],
        requires_approval_above_eth: requires_approval_above_eth || null,
        operating_hours:            operating_hours            || "24/7",
        jurisdiction:               jurisdiction               || "global",
        allowed_protocols:          allowed_protocols          || [],
        prohibited_actions:         prohibited_actions         || [],
        human_override_wallet:      human_override_wallet      || null,
        signature:                  signature                  || null,
        declared_at:                new Date().toISOString(),
        declared_ts:                Date.now(),
      };

      await redis.set(`agentcheck:scope:${wallet.toLowerCase()}`, scope);

      // Log in scope feed
      await redis.lpush("agentcheck:scope_feed", JSON.stringify({
        wallet: wallet.toLowerCase(),
        ts:     Date.now(),
      }));
      await redis.ltrim("agentcheck:scope_feed", 0, 999);

      return res.status(200).json({
        ok: true,
        wallet:   wallet.toLowerCase(),
        scope,
        message:  "Permission scope declared and stored. This will appear in AgentCheck reports for this wallet.",
        note:     "For maximum trust, sign this scope declaration from your agent wallet and include the signature field.",
      });

    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
