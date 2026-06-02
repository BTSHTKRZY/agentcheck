import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  sanitizeWallet, sanitizeText, verifySignature,
  buildActionMessage, isTimestampFresh, checkRateLimit, getClientIdentifier,
} from "../lib/verify.js";

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
const AGENTCHECK  = "https://agentcheck-bice.vercel.app";

async function redisGet(key: string): Promise<any> {
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const d = await r.json() as any;
    return d?.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}

async function redisSet(key: string, value: any): Promise<void> {
  try {
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  } catch {}
}

async function redisPush(key: string, value: any): Promise<void> {
  try {
    await fetch(`${REDIS_URL}/lpush/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(JSON.stringify(value)),
    });
  } catch {}
}

// Reporter's score determines flag weight (Option B — weighted flagging)
async function getReporterWeight(wallet: string): Promise<number> {
  try {
    const r = await fetch(`${AGENTCHECK}/api/check?wallet=${wallet}&source=internal`);
    const d = await r.json() as any;
    const composite = d?.composite || 0;
    if (composite >= 80) return 1.0;
    if (composite >= 60) return 0.6;
    if (composite >= 50) return 0.4;
    if (composite >= 40) return 0.2;
    return 0.05; // Fresh wallet flags barely register — Sybil resistance
  } catch {
    return 0.05;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Rate limit — 10 flags per hour per IP (stricter than endorse)
  const clientId = getClientIdentifier(req);
  const allowed  = await checkRateLimit(`flag:${clientId}`, 10, 3600);
  if (!allowed) {
    return res.status(429).json({ error: "Rate limit exceeded. Max 10 flags per hour." });
  }

  const reporter  = sanitizeWallet(req.body?.reporter);
  const target    = sanitizeWallet(req.body?.wallet);
  const reason    = sanitizeText(req.body?.reason, 100);
  const evidence  = sanitizeText(req.body?.evidence, 500);
  const severity  = sanitizeText(req.body?.severity, 20);
  const signature = req.body?.signature;
  const timestamp = req.body?.timestamp;

  if (!reporter || !target) {
    return res.status(400).json({ error: "Valid reporter and wallet addresses required." });
  }

  // Block self-flagging (nonsensical but prevents gaming)
  if (reporter === target) {
    return res.status(400).json({ error: "Cannot flag your own wallet." });
  }

  const validSeverity = ["low", "medium", "high", "critical"].includes(severity)
    ? severity : "medium";

  if (!reason) {
    return res.status(400).json({ error: "Reason required for flag." });
  }

  // CRITICAL: Signature verification
  if (!signature || !timestamp) {
    return res.status(401).json({
      error: "Signature required to submit a flag.",
      instructions: {
        message_to_sign: buildActionMessage("flag", reporter, target, Date.now()),
        note: "Sign this message with the reporter wallet and resubmit with 'signature' and 'timestamp'.",
      },
    });
  }

  if (!isTimestampFresh(timestamp)) {
    return res.status(401).json({ error: "Timestamp expired. Signatures valid for 10 minutes." });
  }

  const expectedMessage = buildActionMessage("flag", reporter, target, timestamp);
  const validSig = await verifySignature(expectedMessage, signature, reporter);
  if (!validSig) {
    return res.status(401).json({ error: "Invalid signature. Could not verify reporter identity." });
  }

  // Weighted flagging (Option B)
  const weight = await getReporterWeight(reporter);

  const key      = `agentcheck:flagged:${target}`;
  const existing = await redisGet(key) || { flags: [], total_weight: 0, count: 0 };

  // Prevent duplicate flag from same reporter
  if (existing.flags.some((f: any) => f.reporter === reporter)) {
    return res.status(409).json({ error: "You have already flagged this wallet." });
  }

  const severityMultiplier =
    severity === "critical" ? 4 :
    severity === "high"     ? 3 :
    severity === "medium"   ? 2 : 1;

  const flagWeight = weight * severityMultiplier;

  existing.flags.push({
    reporter, reason, evidence, severity,
    weight: flagWeight,
    ts: Date.now(),
  });
  existing.count        += 1;
  existing.total_weight += flagWeight;
  if (existing.flags.length > 50) existing.flags = existing.flags.slice(-50);

  await redisSet(key, existing);

  // Only add to global flag feed if cumulative weight crosses threshold
  // This prevents a single fresh-wallet flag from immediately tarnishing a wallet
  const FLAG_THRESHOLD = 1.0;
  const isActioned = existing.total_weight >= FLAG_THRESHOLD;

  if (isActioned) {
    await redisPush("agentcheck:flag_feed", {
      target, reason, severity,
      total_weight: existing.total_weight,
      ts: Date.now(),
    });
  }

  return res.status(200).json({
    ok: true,
    message: `Flag recorded for ${target}`,
    flag: {
      reporter, target, severity,
      flag_weight:        Math.round(flagWeight * 100) / 100,
      cumulative_weight:  Math.round(existing.total_weight * 100) / 100,
      total_flags:        existing.count,
      actioned:           isActioned,
    },
    note: !isActioned
      ? `Flag recorded but below action threshold (${existing.total_weight.toFixed(2)}/${FLAG_THRESHOLD}). More corroborating flags from established wallets needed before this affects the wallet's score.`
      : "Flag weight crossed action threshold. This now affects the target's risk score.",
  });
}
