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

// Get the endorser's own composite score to weight their endorsement
async function getEndorserWeight(wallet: string): Promise<number> {
  try {
    const r = await fetch(`${AGENTCHECK}/api/check?wallet=${wallet}&source=internal`);
    const d = await r.json() as any;
    const composite = d?.composite || 0;
    // Weight: AAA (90+) = 1.0, scales down. Fresh wallet barely counts.
    // Below 40 composite → weight 0.1 (Sybil resistance)
    if (composite >= 80) return 1.0;
    if (composite >= 60) return 0.7;
    if (composite >= 50) return 0.5;
    if (composite >= 40) return 0.3;
    return 0.1;
  } catch {
    return 0.1;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Rate limit — 20 endorsements per hour per IP
  const clientId = getClientIdentifier(req);
  const allowed  = await checkRateLimit(`endorse:${clientId}`, 20, 3600);
  if (!allowed) {
    return res.status(429).json({ error: "Rate limit exceeded. Max 20 endorsements per hour." });
  }

  const endorser  = sanitizeWallet(req.body?.endorser);
  const endorsed  = sanitizeWallet(req.body?.endorsed);
  const context   = sanitizeText(req.body?.context, 200);
  const signature = req.body?.signature;
  const timestamp = req.body?.timestamp;

  // Validation
  if (!endorser || !endorsed) {
    return res.status(400).json({ error: "Valid endorser and endorsed wallet addresses required." });
  }

  // CRITICAL: Block self-endorsement
  if (endorser === endorsed) {
    return res.status(400).json({ error: "Self-endorsement not allowed." });
  }

  // CRITICAL: Signature verification — prove endorser controls the wallet
  if (!signature || !timestamp) {
    return res.status(401).json({
      error: "Signature required.",
      instructions: {
        message_to_sign: buildActionMessage("endorse", endorser, endorsed, Date.now()),
        note: "Sign this message with the endorser wallet and resubmit with 'signature' and 'timestamp' fields.",
      },
    });
  }

  if (!isTimestampFresh(timestamp)) {
    return res.status(401).json({ error: "Timestamp expired. Signatures valid for 10 minutes." });
  }

  const expectedMessage = buildActionMessage("endorse", endorser, endorsed, timestamp);
  const validSig = await verifySignature(expectedMessage, signature, endorser);
  if (!validSig) {
    return res.status(401).json({ error: "Invalid signature. Could not verify endorser identity." });
  }

  // Get endorser weight for Sybil resistance
  const weight = await getEndorserWeight(endorser);

  // Store endorsement
  const key      = `agentcheck:endorsements:${endorsed}`;
  const existing = await redisGet(key) || { count: 0, weighted: 0, list: [] };

  // Prevent duplicate endorsement from same endorser
  if (existing.list.some((e: any) => e.endorser === endorser)) {
    return res.status(409).json({ error: "You have already endorsed this wallet." });
  }

  existing.count    += 1;
  existing.weighted += weight;
  existing.list.push({
    endorser,
    context,
    weight,
    ts: Date.now(),
  });
  if (existing.list.length > 100) existing.list = existing.list.slice(-100);

  await redisSet(key, existing);

  return res.status(200).json({
    ok: true,
    message: `Endorsement recorded for ${endorsed}`,
    endorsement: {
      endorser,
      endorsed,
      weight,
      total_endorsements: existing.count,
      weighted_score:     Math.round(existing.weighted * 10) / 10,
    },
    note: weight < 0.5
      ? "Your endorsement carries reduced weight because your wallet has limited history. Build trust to increase endorsement weight."
      : "Endorsement weighted by your trust score.",
  });
}
