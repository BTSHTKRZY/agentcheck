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

// Confirm tx exists on-chain and involves both parties.
async function verifyTransaction(
  txHash: string, a: string, b: string, network: string
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
    return (from === a && to === b) || (from === b && to === a);
  } catch { return false; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET: list pending endorsement requests for a wallet ────────────────────
  if (req.method === "GET") {
    const wallet = sanitizeWallet(req.query?.wallet);
    if (!wallet) return res.status(400).json({ error: "Valid wallet required." });
    const pending = await redisGet(`agentcheck:endorse_requests:${wallet}`) || { requests: [] };
    return res.status(200).json({
      wallet,
      pending_requests: pending.requests || [],
      count: (pending.requests || []).length,
      note: "Wallets that have requested your endorsement. Endorse via POST /api/endorse.",
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

  // Rate limit — 15 requests per hour per IP
  const clientId = getClientIdentifier(req);
  const allowed  = await checkRateLimit(`reqendorse:${clientId}`, 15, 3600);
  if (!allowed) {
    return res.status(429).json({ error: "Rate limit exceeded. Max 15 endorsement requests per hour." });
  }

  const requester = sanitizeWallet(req.body?.requester);
  const counterparty = sanitizeWallet(req.body?.counterparty);
  const context   = sanitizeText(req.body?.context, 200);
  const txHash    = sanitizeText(req.body?.tx_hash, 66);
  const network   = sanitizeNetwork(req.body?.network);
  const signature = req.body?.signature;
  const timestamp = req.body?.timestamp;

  if (!requester || !counterparty) {
    return res.status(400).json({ error: "Valid requester and counterparty addresses required." });
  }
  if (requester === counterparty) {
    return res.status(400).json({ error: "Cannot request an endorsement from yourself." });
  }

  // Signature — prove the requester controls the wallet
  if (!signature || !timestamp) {
    return res.status(401).json({
      error: "Signature required.",
      instructions: {
        message_to_sign: buildActionMessage("endorse", requester, counterparty, Date.now()),
        note: "Sign with the requester wallet, resubmit with 'signature' and 'timestamp'.",
      },
    });
  }
  if (!isTimestampFresh(timestamp)) {
    return res.status(401).json({ error: "Timestamp expired. Signatures valid for 10 minutes." });
  }
  const expectedMessage = buildActionMessage("endorse", requester, counterparty, timestamp);
  const validSig = await verifySignature(expectedMessage, signature, requester);
  if (!validSig) {
    return res.status(401).json({ error: "Invalid signature." });
  }

  // If a tx_hash is supplied, verify the two parties actually transacted.
  let txVerified = false;
  if (txHash) {
    txVerified = await verifyTransaction(txHash, requester, counterparty, network);
    if (!txVerified) {
      return res.status(400).json({
        error: "Transaction verification failed. tx_hash must exist on-chain and involve both wallets.",
      });
    }
  }

  // Store the pending request under the counterparty (the one who would endorse).
  const key      = `agentcheck:endorse_requests:${counterparty}`;
  const existing = await redisGet(key) || { requests: [] };

  if (existing.requests.some((r: any) => r.requester === requester)) {
    return res.status(409).json({ error: "You already have a pending endorsement request to this wallet." });
  }

  existing.requests.push({
    requester, context,
    tx_hash: txHash || null,
    tx_verified: txVerified,
    ts: Date.now(),
  });
  if (existing.requests.length > 50) existing.requests = existing.requests.slice(-50);
  await redisSet(key, existing);

  return res.status(200).json({
    ok: true,
    message: `Endorsement request sent to ${counterparty}`,
    request: {
      requester, counterparty,
      tx_verified: txVerified,
      pending_total: existing.requests.length,
    },
    note: txVerified
      ? "Request includes a verified on-chain transaction — stronger signal for the endorser."
      : "Request sent. Including a tx_hash of a real transaction between you strengthens the request.",
  });
}
