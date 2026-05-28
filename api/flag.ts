import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — check if a wallet is flagged
  if (req.method === "GET") {
    const wallet = (req.query?.wallet || "").toString().toLowerCase().trim();
    if (!wallet || !wallet.startsWith("0x")) {
      return res.status(400).json({ error: "Valid wallet address required" });
    }
    try {
      const flagData: any = await redis.get(`agentcheck:flagged:${wallet}`).catch(() => null);
      if (!flagData) {
        return res.status(200).json({ wallet, flagged: false });
      }
      return res.status(200).json({ wallet, flagged: true, ...flagData });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — submit a flag
  if (req.method !== "POST") return res.status(405).json({ error: "POST or GET only" });

  const {
    wallet,        // wallet being flagged
    reporter,      // wallet doing the reporting
    reason,        // category of concern
    evidence,      // tx hash, description, or URL
    severity,      // low, medium, high, critical
  } = req.body;

  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
    return res.status(400).json({ error: "Valid wallet address required" });
  }
  if (!reporter || !reporter.startsWith("0x")) {
    return res.status(400).json({ error: "reporter wallet address required" });
  }
  if (!reason) {
    return res.status(400).json({
      error: "reason required",
      valid_reasons: ["phishing", "scam", "rug_pull", "drainer", "spam_bot", "mixer", "malicious_contract", "other"],
    });
  }

  const validReasons   = ["phishing","scam","rug_pull","drainer","spam_bot","mixer","malicious_contract","other"];
  const validSeverities = ["low","medium","high","critical"];

  if (!validReasons.includes(reason)) {
    return res.status(400).json({ error: `Invalid reason. Use: ${validReasons.join(", ")}` });
  }

  const flagSeverity = validSeverities.includes(severity) ? severity : "medium";

  try {
    // Get existing flag data
    const existingFlag: any = await redis.get(`agentcheck:flagged:${wallet.toLowerCase()}`).catch(() => null);
    const existing = existingFlag || { count: 0, reports: [], severity: "low" };

    // Check for duplicate reporter
    const alreadyReported = existing.reports?.some(
      (r: any) => r.reporter?.toLowerCase() === reporter.toLowerCase()
    );
    if (alreadyReported) {
      return res.status(409).json({
        error: "This reporter has already flagged this wallet",
        current_flags: existing.count,
      });
    }

    // Add report
    existing.reports = existing.reports || [];
    existing.reports.push({
      reporter:  reporter.toLowerCase(),
      reason,
      evidence:  evidence || null,
      severity:  flagSeverity,
      ts:        Date.now(),
    });
    existing.count     = existing.reports.length;
    existing.wallet    = wallet.toLowerCase();
    existing.reason    = reason; // most recent reason
    existing.severity  = flagSeverity;
    existing.first_flagged = existing.first_flagged || new Date().toISOString();
    existing.last_flagged  = new Date().toISOString();

    await Promise.all([
      redis.set(`agentcheck:flagged:${wallet.toLowerCase()}`, existing),
      redis.lpush("agentcheck:flag_feed", JSON.stringify({
        wallet:   wallet.toLowerCase(),
        reporter: reporter.toLowerCase(),
        reason,
        severity: flagSeverity,
        ts:       Date.now(),
      })),
      redis.ltrim("agentcheck:flag_feed", 0, 9999),
      redis.incr("agentcheck:total_flags"),
    ]).catch(() => {});

    return res.status(200).json({
      ok: true,
      wallet:        wallet.toLowerCase(),
      total_reports: existing.count,
      severity:      flagSeverity,
      message:       `Flag recorded. ${wallet} now has ${existing.count} community report${existing.count === 1 ? "" : "s"}. This will affect their AgentCheck risk score.`,
      note:          "Flags affect the counterparty risk score of anyone who has transacted with this wallet. Malicious flagging of legitimate wallets is discouraged — reporters are recorded.",
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
