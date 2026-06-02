// lib/verify.ts — signature verification + input sanitization shared helpers

import { verifyMessage } from "viem";

// ── INPUT SANITIZATION ────────────────────────────────────────────────────────

const VALID_NETWORKS = ["eth", "base", "polygon", "bsc", "arbitrum"];

export function sanitizeWallet(input: any): string | null {
  if (typeof input !== "string") return null;
  const w = input.toLowerCase().trim();
  if (!/^0x[a-f0-9]{40}$/.test(w)) return null;
  return w;
}

export function sanitizeNetwork(input: any): string {
  if (typeof input !== "string") return "eth";
  const n = input.toLowerCase().trim();
  return VALID_NETWORKS.includes(n) ? n : "eth";
}

export function sanitizeSource(input: any): string {
  if (typeof input !== "string") return "unknown";
  // Alphanumeric + dash/underscore only, max 32 chars — prevents Redis key injection
  const s = input.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  return s || "unknown";
}

export function sanitizeText(input: any, maxLen: number = 280): string {
  if (typeof input !== "string") return "";
  // Strip control characters, cap length
  return input.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, maxLen);
}

// ── SIGNATURE VERIFICATION ────────────────────────────────────────────────────

/**
 * Verifies that `signature` was produced by `claimedSigner` signing `message`.
 * Returns true only if the recovered address matches the claimed signer.
 *
 * The message format is fixed per action to prevent signature reuse across
 * different action types (replay protection within a 10-minute window).
 */
export async function verifySignature(
  message: string,
  signature: string,
  claimedSigner: string
): Promise<boolean> {
  try {
    if (!signature || !signature.startsWith("0x")) return false;
    const signer = sanitizeWallet(claimedSigner);
    if (!signer) return false;

    const valid = await verifyMessage({
      address:   signer as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    return valid;
  } catch {
    return false;
  }
}

/**
 * Builds the canonical message that a reporter must sign for a given action.
 * Includes a timestamp to allow replay-window enforcement.
 */
export function buildActionMessage(
  action:    "endorse" | "flag" | "outcome",
  reporter:  string,
  target:    string,
  timestamp: number
): string {
  return `AgentCheck:${action}\nreporter:${reporter.toLowerCase()}\ntarget:${target.toLowerCase()}\nts:${timestamp}`;
}

/**
 * Checks that a timestamp is within the allowed replay window (10 minutes).
 * Prevents an old signature from being reused indefinitely.
 */
export function isTimestampFresh(timestamp: number, windowMs: number = 10 * 60 * 1000): boolean {
  const now = Date.now();
  return typeof timestamp === "number" &&
         timestamp <= now + 60000 &&        // not in the future (1 min skew)
         now - timestamp <= windowMs;        // not older than window
}

// ── RATE LIMITING ─────────────────────────────────────────────────────────────

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

/**
 * Simple sliding-window rate limit using Redis.
 * Returns true if the request is ALLOWED, false if rate limited.
 */
export async function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const key = `agentcheck:ratelimit:${identifier}`;
    // INCR the counter
    const incrRes = await fetch(`${REDIS_URL}/incr/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const incrData = await incrRes.json() as any;
    const count    = incrData?.result || 1;

    // First request in window — set expiry
    if (count === 1) {
      await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${windowSeconds}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      });
    }

    return count <= maxRequests;
  } catch {
    // On Redis failure, allow the request (fail open for availability)
    return true;
  }
}

export function getClientIdentifier(req: any): string {
  const fwd = req.headers?.["x-forwarded-for"];
  const ip  = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim()
           || req.headers?.["x-real-ip"]
           || "unknown";
  return String(ip).replace(/[^a-z0-9.:]/gi, "").slice(0, 45);
}
