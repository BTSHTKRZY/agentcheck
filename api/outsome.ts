import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  sanitizeWallet, sanitizeText, sanitizeNetwork, verifySignature,
  buildActionMessage, isTimestampFresh, checkRateLimit, getClientIdentifier,
} from "../lib/verify.js";

const REDIS_URL     = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN   = process.env.UPSTASH_REDIS_REST_TOKEN!;
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || "";

const CHAIN_IDS: Record<string, number> = {
  eth: 1, base: 8453, polygon: 137, bsc: 56, arbitrum: 42161,
};

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

// Verify the tx_hash exists on-chain AND involves both reporter and counterparty
async function verifyTransaction(
  txHash: string,
  reporter: string,
  counterparty: string,
  network: string
): Promise<boolean> {
  try {
    if (!/^0x[a-f0-9]{64}$/.test(txHash.toLowerCase())) return false;
    const chainId = CHAIN_IDS[network] || 1;

    const r = await fetch(
      `https://api.etherscan.io/v2/api?chainid=${chainId}&module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${ETHERSCAN_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const d  = await r.json() as any;
    const tx = d?.result;
    if (!tx) return false;

    const from = (tx.from || "").toLowerCase();
    const to   = (tx.to   || "").toLowerCase();
    const rep  = reporter.toLowerCase();
    const cp   = counterparty.toLowerCase();

    // The transaction must involve both parties
    return (from === rep && to === cp) || (from === cp && to === rep);
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Rate limit — 30 outcomes per hour per IP
  const clientId = getClientIdentifier(req);
  const allowed  = await checkRateLimit(`outcome:${clientId}`, 30, 3600);
  if (!allowed) {
    return res.status(429).json({ error: "Rate limit exceeded. Max 30 outcome reports per hour." });
  }

  const reporter  = sanitizeWallet(req.body?.reporter);
  const target    = sanitizeWallet(req.body?.wallet);
  const outcome   = sanitizeText(req.body?.outcome, 20);
  const context   = sanitizeText(req.body?.context, 200);
  const txHash    = sanitizeText(req.body?.tx_hash, 66);
  const network   = sanitizeNetwork(req.body?.network);
  const signature = req.body?.signature;
  const timestamp = req.body?.timestamp;

  if (!reporter || !target) {
    return res.status(400).json({ error: "Valid reporter and wallet addresses required." });
  }
  if (reporter === target) {
    return res.status(400).json({ error: "Cannot report outcome on your own wallet." });
  }

  const validOutcome = ["positive", "negative", "neutral"].includes(outcome);
  if (!validOutcome) {
    return res.status(400).json({ error: "Outcome must be positive, negative, or neutral." });
  }

  // CRITICAL: Signature verification
  if (!signature || !timestamp) {
    return res.status(401).json({
      error: "Signature required.",
      instructions: {
        message_to_sign: buildActionMessage("outcome", reporter, target, Date.now()),
        note: "Sign with reporter wallet, resubmit with 'signature' and 'timestamp'.",
      },
    });
  }
  if (!isTimestampFresh(timestamp)) {
    return res.status(401).json({ error: "Timestamp expired. Signatures valid for 10 minutes." });
  }
  const expectedMessage = buildActionMessage("outcome", reporter, target, timestamp);
  const validSig = await verifySignature(expectedMessage, signature, reporter);
  if (!validSig) {
    return res.status(401).json({ error: "Invalid signature." });
  }

  // CRITICAL: Verify the transaction actually happened between these parties
  // This prevents outcome farming with fabricated tx hashes
  let txVerified = false;
  if (txHash) {
    txVerified = await verifyTransaction(txHash, reporter, target, network);
    if (!txVerified) {
      return res.status(400).json({
        error: "Transaction verification failed. The tx_hash must exist on-chain and involve both reporter and target wallets.",
      });
    }
  } else {
    // Outcome without tx_hash is allowed but marked unverified and weighted to zero
    return res.status(400).json({
      error: "tx_hash required. Outcomes must reference a verifiable on-chain transaction between the two wallets.",
    });
  }

  const key      = `agentcheck:outcomes:${target}`;
  const existing = await redisGet(key) || {
    positive: 0, negative: 0, neutral: 0, total: 0, list: [],
  };

  // Prevent duplicate outcome for same tx_hash
  if (existing.list.some((o: any) => o.tx_hash === txHash)) {
    return res.status(409).json({ error: "An outcome has already been reported for this transaction." });
  }

  existing[outcome] += 1;
  existing.total    += 1;
  existing.list.push({
    reporter, outcome, context, tx_hash: txHash,
    verified: txVerified, ts: Date.now(),
  });
  if (existing.list.length > 100) existing.list = existing.list.slice(-100);

  await redisSet(key, existing);

  return res.status(200).json({
    ok: true,
    message: `Verified outcome recorded for ${target}`,
    outcome: {
      reporter, target, outcome,
      tx_verified: txVerified,
      totals: {
        positive: existing.positive,
        negative: existing.negative,
        neutral:  existing.neutral,
        total:    existing.total,
      },
    },
    note: "Outcome verified against on-chain transaction. This carries full weight in the trust score.",
  });
}
