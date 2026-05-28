import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const GETBLOCK_KEY  = process.env.GETBLOCK_API_KEY || "";
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || "";

// Known phishing / drainer contract patterns
const KNOWN_DRAINER_SIGNATURES = [
  "0xa9059cbb", // ERC-20 transfer (used in approval phishing)
  "0x23b872dd", // transferFrom (used in NFT drainers)
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // The wallet attempting to interact (the one being checked)
  const querying = (
    req.query?.querying || req.body?.querying || req.query?.wallet || req.body?.wallet || ""
  ).toString().toLowerCase().trim();

  // Optional: the target being interacted with (for context)
  const target = (
    req.query?.target || req.body?.target || ""
  ).toString().toLowerCase().trim();

  const network = (
    req.query?.network || req.body?.network || "eth"
  ).toString().toLowerCase();

  if (!querying || !querying.startsWith("0x") || querying.length !== 42) {
    return res.status(400).json({
      error: "Provide querying wallet address (the wallet trying to interact)",
    });
  }

  try {
    const [
      ethTxRes,
      getblockRes,
      flaggedRes,
    ] = await Promise.allSettled([

      // 1. Etherscan — recent transactions of the querying wallet
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${querying}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 2. GetBlock fraud check on the querying wallet
      fetch(
        `https://hub-api.getblock.io/wallet-risk/fraudCheck`,
        {
          method: "POST",
          headers: { "x-api-key": GETBLOCK_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ address: querying, network }),
        }
      ).then(r => r.json()).catch(() => null),

      // 3. Check our own flagged list in Redis
      redis.get(`agentcheck:flagged:${querying}`).catch(() => null),
    ]);

    const txData   = ethTxRes.status   === "fulfilled" ? ethTxRes.value   : null;
    const gbData   = getblockRes.status === "fulfilled" ? getblockRes.value : null;
    const flagged  = flaggedRes.status  === "fulfilled" ? flaggedRes.value  : null;

    const txList   = txData?.result && Array.isArray(txData.result) ? txData.result : [];

    // ── THREAT SIGNALS ────────────────────────────────────────────────────────

    const threats: string[] = [];
    let threatLevel: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "NONE";
    let threatScore = 0;

    // GetBlock signals
    const gbRisk       = gbData?.risk_score        ?? null;
    const gbFlags      = gbData?.flags             ?? [];
    const gbSanctioned = gbData?.sanctions?.sanctioned ?? false;

    if (gbSanctioned) {
      threats.push("SANCTIONED ENTITY — OFAC/EU/UN listed");
      threatScore = 100;
      threatLevel = "CRITICAL";
    }
    if (gbFlags.includes("darkweb_transaction")) {
      threats.push("Darkweb transaction history detected");
      threatScore = Math.max(threatScore, 90);
    }
    if (gbFlags.includes("phishing")) {
      threats.push("Known phishing wallet");
      threatScore = Math.max(threatScore, 85);
    }
    if (gbFlags.includes("rug_pull")) {
      threats.push("Rug pull history detected");
      threatScore = Math.max(threatScore, 80);
    }
    if (gbFlags.includes("mixer_interaction")) {
      threats.push("Mixer/tumbler interaction — anonymisation attempt");
      threatScore = Math.max(threatScore, 70);
    }

    // Our own community flags
    if (flagged) {
      const f = flagged as any;
      threats.push(`Community flagged: ${f.reason || "reported as malicious"}`);
      threatScore = Math.max(threatScore, 75);
    }

    // Etherscan pattern analysis
    const ageDays = (() => {
      const oldest = txList[txList.length - 1];
      if (!oldest) return 0;
      return Math.floor((Date.now() - parseInt(oldest.timeStamp) * 1000) / 86400000);
    })();

    const failRate = txList.length > 0
      ? txList.filter((t: any) => t.isError === "1").length / txList.length
      : 0;

    // Very new wallet + active = potential bot/spam
    if (ageDays < 3 && txList.length > 20) {
      threats.push("Very new wallet with unusually high transaction volume — possible bot");
      threatScore = Math.max(threatScore, 55);
    }

    // High failure rate = potential spam or malformed attack attempts
    if (failRate > 0.4 && txList.length > 10) {
      threats.push(`High transaction failure rate (${Math.round(failRate * 100)}%) — possible spam or attack pattern`);
      threatScore = Math.max(threatScore, 50);
    }

    // Contract interaction pattern — check if querying wallet is itself a contract
    const isContract = txList.some((t: any) => t.contractAddress && t.contractAddress !== "");

    // Rapid-fire same-target transactions (potential spam attack)
    if (target) {
      const targetTxs = txList.filter((t: any) =>
        t.to?.toLowerCase() === target.toLowerCase()
      );
      if (targetTxs.length > 5) {
        threats.push(`${targetTxs.length} recent transactions to this same target — possible spam`);
        threatScore = Math.max(threatScore, 60);
      }
    }

    // Determine threat level from score
    if (threatScore >= 90)      threatLevel = "CRITICAL";
    else if (threatScore >= 70) threatLevel = "HIGH";
    else if (threatScore >= 50) threatLevel = "MEDIUM";
    else if (threatScore >= 20) threatLevel = "LOW";
    else                        threatLevel = "NONE";

    // ── RECOMMENDATION ────────────────────────────────────────────────────────

    const recommendation = (() => {
      switch (threatLevel) {
        case "CRITICAL": return "BLOCK — Do not interact. Sanctioned or confirmed malicious entity.";
        case "HIGH":     return "REJECT — High probability of malicious intent. Do not proceed.";
        case "MEDIUM":   return "CAUTION — Suspicious signals detected. Require additional verification before proceeding.";
        case "LOW":      return "MONITOR — Minor concerns noted. Proceed with reduced trust and lower limits.";
        case "NONE":     return "ALLOW — No threat signals detected. Normal interaction patterns.";
      }
    })();

    // Store inbound check in Redis for pattern detection
    Promise.all([
      redis.lpush(`agentcheck:inbound:${querying}`, JSON.stringify({
        target: target || null,
        threat_level: threatLevel,
        threat_score: threatScore,
        ts: Date.now(),
      })),
      redis.ltrim(`agentcheck:inbound:${querying}`, 0, 99),
      redis.incr("agentcheck:threat_checks_total"),
      threatScore > 50
        ? redis.incr("agentcheck:threats_detected")
        : Promise.resolve(),
    ]).catch(() => {});

    // ── RESPONSE ──────────────────────────────────────────────────────────────

    return res.status(200).json({
      querying_wallet:   querying,
      target_wallet:     target || null,
      network,
      checked_at:        new Date().toISOString(),

      // Threat summary
      threat_level:      threatLevel,
      threat_score:      threatScore,
      recommendation,
      safe_to_interact:  threatLevel === "NONE" || threatLevel === "LOW",

      // Signals
      threats_detected:  threats,
      threat_count:      threats.length,

      // Raw signals
      signals: {
        getblock_risk:      gbRisk,
        getblock_flags:     gbFlags,
        sanctioned:         gbSanctioned,
        wallet_age_days:    ageDays,
        recent_tx_count:    txList.length,
        failure_rate:       `${Math.round(failRate * 100)}%`,
        is_contract:        isContract,
        community_flagged:  !!flagged,
        target_tx_count:    target
          ? txList.filter((t: any) => t.to?.toLowerCase() === target.toLowerCase()).length
          : null,
      },

      // Actions
      actions: {
        report_as_malicious: "POST https://agentcheck-bice.vercel.app/api/flag",
        full_rating:         `GET https://agentcheck-bice.vercel.app/api/check?wallet=${querying}`,
        human_report:        `GET https://agentcheck-bice.vercel.app/api/report?wallet=${querying}`,
      },

      powered_by: ["Etherscan v2", "GetBlock Fraud Check", "AgentCheck Community Flags"],
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
