import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  sanitizeWallet, sanitizeNetwork, sanitizeSource,
  checkRateLimit, getClientIdentifier,
} from "../lib/verify.js";
import { getLabel, isKnownContract, KnownAddress } from "../lib/knownAddresses.js";

const ETHERSCAN_KEY    = process.env.ETHERSCAN_API_KEY    || "";
const GETBLOCK_KEY     = process.env.GETBLOCK_API_KEY     || "";
const OPENSEA_KEY      = process.env.OPENSEA_API_KEY      || "";
const NORMIES_API      = "https://api.normies.art";
const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const ERC8257_REGISTRY = "0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1";
const BASE_RPC         = "https://mainnet.base.org";
const REDIS_URL        = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN      = process.env.UPSTASH_REDIS_REST_TOKEN!;

// ── REDIS HELPERS ─────────────────────────────────────────────────────────────

async function redisGet(key: string): Promise<any> {
  try {
    const res  = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const data = await res.json() as any;
    return data?.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function redisSet(key: string, value: any): Promise<void> {
  try {
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body:    JSON.stringify(value),
    });
  } catch {}
}

async function redisPush(key: string, value: any): Promise<void> {
  try {
    await fetch(`${REDIS_URL}/lpush/${encodeURIComponent(key)}`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body:    JSON.stringify(JSON.stringify(value)),
    });
  } catch {}
}

async function redisIncr(key: string): Promise<void> {
  try {
    await fetch(`${REDIS_URL}/incr/${encodeURIComponent(key)}`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
  } catch {}
}

// ── RATING SCALE ──────────────────────────────────────────────────────────────

function compositeToLetter(composite: number): string {
  if (composite >= 90) return "AAA";
  if (composite >= 80) return "AA";
  if (composite >= 70) return "A";
  if (composite >= 60) return "BBB";
  if (composite >= 50) return "BB";
  if (composite >= 40) return "B";
  if (composite >= 30) return "CCC";
  if (composite >= 20) return "CC";
  if (composite >= 10) return "C";
  return "D";
}

function letterToVerdict(letter: string, isAgent: boolean): string {
  const e = isAgent ? "agent" : "wallet";
  switch (letter) {
    case "AAA": return `Exceptional ${e}. Highest trust. Safe to transact.`;
    case "AA":  return `Strong ${e}. Established track record. Safe to transact.`;
    case "A":   return `Good ${e}. Solid history. Generally safe to transact.`;
    case "BBB": return `Adequate ${e}. Limited history but no adverse flags.`;
    case "BB":  return `Speculative ${e}. Proceed with caution and smaller amounts.`;
    case "B":   return `Weak ${e}. Significant gaps or minor concerns. Exercise caution.`;
    case "CCC": return `Poor ${e}. Active risk flags present. Avoid high-value transactions.`;
    case "CC":  return `Very poor ${e}. Multiple serious flags. Do not transact.`;
    case "C":   return `High risk. Known adverse activity. Do not transact.`;
    case "D":   return `Confirmed malicious or sanctioned. Do not transact under any circumstances.`;
    default:    return "Insufficient data to rate.";
  }
}

function outlookCalc(trust: number, prev: number | null): string {
  if (prev === null) return "stable";
  const delta = trust - prev;
  if (delta > 5)  return "positive";
  if (delta < -5) return "negative";
  return "stable";
}

// ── TRUST SCORE ───────────────────────────────────────────────────────────────

function computeTrustScore(data: {
  ageDays:            number;
  totalTx:            number;
  successRate:        number;
  defiProtocols:      number;
  endorsements:       number;
  outcomesPositive:   number;
  outcomesTotal:      number;
  erc8257Calls:       number;   // NEW — ERC-8257 tool usage
  counterpartyAvgScore: number; // NEW — wallet relationship graph
}): { score: number; breakdown: Record<string, number> } {

  const ageScore =
    data.ageDays > 1460 ? 15 :
    data.ageDays > 730  ? 13 :
    data.ageDays > 365  ? 11 :
    data.ageDays > 180  ? 8  :
    data.ageDays > 90   ? 5  :
    data.ageDays > 30   ? 2  : 0;

  const txScore = Math.min(15, Math.floor(Math.log10(Math.max(1, data.totalTx)) * 4));

  const successScore =
    data.successRate >= 0.99 ? 20 :
    data.successRate >= 0.97 ? 18 :
    data.successRate >= 0.95 ? 15 :
    data.successRate >= 0.90 ? 10 :
    data.successRate >= 0.80 ? 5  : 0;

  const defiScore    = Math.min(10, data.defiProtocols * 2);
  const endorseScore = Math.min(10, data.endorsements * 3);
  const outcomeScore = data.outcomesTotal > 0
    ? Math.round((data.outcomesPositive / data.outcomesTotal) * 5)
    : 0;

  // ERC-8257 tool usage — max 10 pts
  const toolScore = Math.min(10, data.erc8257Calls * 2);

  // Wallet relationship graph — max 10 pts
  // Average score of counterparties maps to trust signal
  const relationshipScore = data.counterpartyAvgScore > 0
    ? Math.round((data.counterpartyAvgScore / 100) * 10)
    : 0;

  const score =
    ageScore + txScore + successScore + defiScore +
    endorseScore + outcomeScore + toolScore + relationshipScore;

  return {
    score: Math.min(100, score),
    breakdown: {
      wallet_age:           ageScore,
      transaction_volume:   txScore,
      success_rate:         successScore,
      defi_diversity:       defiScore,
      endorsements:         endorseScore,
      outcome_accuracy:     outcomeScore,
      erc8257_tool_usage:   toolScore,
      relationship_graph:   relationshipScore,
    },
  };
}

// ── RISK SCORE ────────────────────────────────────────────────────────────────

function computeRiskScore(data: {
  getblockRisk:        number | null;
  sanctioned:          boolean;
  mixerInteraction:    boolean;
  darkwebFlag:         boolean;
  phishingFlag:        boolean;
  rugPullFlag:         boolean;
  newAddress:          boolean;
  communityFlagged:    boolean;
  counterpartyRisk:    number;
}): { score: number; flags: string[] } {

  let score = data.getblockRisk ?? 20;
  const flags: string[] = [];

  if (data.sanctioned)            { score = 100; flags.push("sanctioned_entity"); }
  if (data.darkwebFlag)           { score = Math.max(score, 90); flags.push("darkweb_interaction"); }
  if (data.phishingFlag)          { score = Math.max(score, 80); flags.push("phishing_association"); }
  if (data.rugPullFlag)           { score = Math.max(score, 85); flags.push("rug_pull_history"); }
  if (data.mixerInteraction)      { score = Math.max(score, 75); flags.push("mixer_interaction"); }
  if (data.communityFlagged)      { score = Math.max(score, 70); flags.push("community_flagged"); }
  if (data.counterpartyRisk > 60) {
    score = Math.max(score, 50);
    flags.push(`high_risk_counterparties`);
  }
  if (data.newAddress) flags.push("new_address_limited_history");

  return { score: Math.min(100, score), flags };
}

// ── AGENT SCORE ───────────────────────────────────────────────────────────────

function computeAgentScore(data: {
  isErc8004:          boolean;
  agentName:          string | null;
  agentType:          string | null;
  agentLevel:         number | null;
  hasAgentBinding:    boolean;
  agentCapabilities:  string[];
  hasTBA:             boolean;
  erc8257Calls:       number;
  certifications:     string[];
  certExpired:        boolean;
}): { score: number; highlights: string[] } {

  let score = 0;
  const highlights: string[] = [];

  if (data.isErc8004) {
    score += 25;
    highlights.push(`ERC-8004 registered${data.agentName ? ` — ${data.agentName}` : ""}${data.agentType ? ` (${data.agentType})` : ""}`);
  }
  if (data.hasAgentBinding) {
    score += 15;
    highlights.push("Agent binding confirmed via OpenSea API");
  }
  if (data.agentCapabilities.length > 0) {
    score += Math.min(10, data.agentCapabilities.length * 2);
    highlights.push(`Capabilities: ${data.agentCapabilities.slice(0, 3).join(", ")}`);
  }
  if (data.hasTBA) {
    score += 15;
    highlights.push("ERC-6551 Token Bound Account confirmed");
  }
  if (data.erc8257Calls > 0) {
    const s = Math.min(15, data.erc8257Calls * 3);
    score  += s;
    highlights.push(`${data.erc8257Calls} ERC-8257 registry interactions`);
  }
  if (data.certifications.length > 0 && !data.certExpired) {
    score += Math.min(15, data.certifications.length * 5);
    highlights.push(`Safety certified: ${data.certifications.join(", ").replace(/_/g, " ")}`);
  } else if (data.certifications.length > 0 && data.certExpired) {
    highlights.push("Safety certifications EXPIRED — recertification required");
  }

  return { score: Math.min(100, score), highlights };
}

// ── COMPOSITE ─────────────────────────────────────────────────────────────────

function compositeScore(trust: number, risk: number, agent: number): number {
  return Math.round(trust * 0.5 + (100 - risk) * 0.3 + agent * 0.2);
}

// ── ERC-8257 TOOL USAGE (Base network) ───────────────────────────────────────

// Detect whether an address is a contract (has code) vs an EOA.
// One eth_getCode call on mainnet. Returns true if contract.
async function isContractAddress(wallet: string, chainId: number = 1): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.etherscan.io/v2/api?chainid=${chainId}&module=proxy&action=eth_getCode&address=${wallet}&tag=latest&apikey=${ETHERSCAN_KEY}`,
      { signal: AbortSignal.timeout(6000) }
    );
    const data = await res.json() as any;
    const code = data?.result || "0x";
    return code !== "0x" && code.length > 2;
  } catch {
    return false;
  }
}

// Increment the rating distribution counter (fire-and-forget).
async function incrRatingCounter(rating: string): Promise<void> {
  try {
    await fetch(`${REDIS_URL}/incr/${encodeURIComponent("agentcheck:rating:" + rating)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
  } catch {}
}

async function getErc8257Usage(wallet: string): Promise<number> {
  try {
    // Check Base network for transactions to the ERC-8257 registry
    const res  = await fetch(
      `https://api.etherscan.io/v2/api?chainid=8453&module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${ETHERSCAN_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json() as any;
    const txs  = Array.isArray(data?.result) ? data.result : [];

    const registryCalls = txs.filter((tx: any) =>
      tx.to?.toLowerCase() === ERC8257_REGISTRY.toLowerCase() &&
      tx.isError === "0"
    ).length;

    return registryCalls;
  } catch {
    return 0;
  }
}

// ── WALLET RELATIONSHIP GRAPH ─────────────────────────────────────────────────

async function getRelationshipGraph(
  wallet:       string,
  counterparties: string[]
): Promise<{
  avgScore:        number;
  checkedCount:    number;
  trustedCount:    number;
  riskyCount:      number;
  details:         Array<{ wallet: string; rating: string; composite: number }>;
}> {
  // counterparties here are already filtered to likely-EOA peers.
  if (counterparties.length === 0) {
    return { avgScore: 0, checkedCount: 0, trustedCount: 0, riskyCount: 0, details: [] };
  }

  // Check top 10 counterparties via AgentCheck batch
  const top10 = counterparties.slice(0, 10);

  try {
    const res  = await fetch(
      `https://agentcheck-bice.vercel.app/api/batch`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ wallets: top10, network: "eth" }),
        signal:  AbortSignal.timeout(15000),
      }
    );
    const data    = await res.json() as any;
    const results = data?.results || [];

    if (results.length === 0) {
      return { avgScore: 0, checkedCount: 0, trustedCount: 0, riskyCount: 0, details: [] };
    }

    const details = results.map((r: any) => ({
      wallet:    r.wallet,
      rating:    r.rating    || "UNKNOWN",
      composite: r.composite || 0,
    }));

    const avgScore    = Math.round(
      details.reduce((s: number, r: any) => s + r.composite, 0) / details.length
    );
    const trustedCount = details.filter((r: any) => r.composite >= 60).length;
    const riskyCount   = details.filter((r: any) => r.composite < 40).length;

    return {
      avgScore,
      checkedCount: details.length,
      trustedCount,
      riskyCount,
      details: details.slice(0, 5), // return top 5 in response
    };
  } catch {
    return { avgScore: 0, checkedCount: 0, trustedCount: 0, riskyCount: 0, details: [] };
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Sanitized inputs — prevents Redis key injection
  const wallet  = sanitizeWallet(req.query?.wallet || req.body?.wallet);
  const network = sanitizeNetwork(req.query?.network || req.body?.network);
  const source  = sanitizeSource(req.query?.source || req.body?.source);

  if (!wallet) {
    return res.status(400).json({
      error: "Invalid wallet address. Provide a valid 0x Ethereum address.",
    });
  }

  // Rate limiting — 60 checks per minute per IP. Internal calls bypass.
  if (source !== "internal") {
    const clientId = getClientIdentifier(req);
    const allowed  = await checkRateLimit(`check:${clientId}`, 60, 60);
    if (!allowed) {
      return res.status(429).json({
        error: "Rate limit exceeded. Max 60 checks per minute.",
        retry_after_seconds: 60,
      });
    }
  }

  try {
    const [
      ethTxRes,
      ethFirstTxRes,
      ethBalRes,
      ethInternalRes,
      getblockRes,
      normiesAgentRes,
      openSeaAgentRes,
    ] = await Promise.allSettled([

      // 1. Recent transactions — up to 200 with Pro
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=200&sort=desc&apikey=${ETHERSCAN_KEY}`,
        { signal: AbortSignal.timeout(10000) }
      ).then(r => r.json()),

      // 2. First ever transaction — true wallet age
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc&apikey=${ETHERSCAN_KEY}`,
        { signal: AbortSignal.timeout(10000) }
      ).then(r => r.json()),

      // 3. ETH balance
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance&address=${wallet}&tag=latest&apikey=${ETHERSCAN_KEY}`,
        { signal: AbortSignal.timeout(8000) }
      ).then(r => r.json()),

      // 4. Internal transactions — ERC-6551 TBA detection
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlistinternal&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${ETHERSCAN_KEY}`,
        { signal: AbortSignal.timeout(8000) }
      ).then(r => r.json()),

      // 5. GetBlock fraud check
      fetch(
        `https://hub-api.getblock.io/wallet-risk/fraudCheck`,
        {
          method:  "POST",
          headers: { "x-api-key": GETBLOCK_KEY, "Content-Type": "application/json" },
          body:    JSON.stringify({ address: wallet, network }),
          signal:  AbortSignal.timeout(8000),
        }
      ).then(r => r.json()).catch(() => null),

      // 6. Normies ERC-8004 agent identity
      fetch(
        `${NORMIES_API}/agents/info/${wallet}`,
        { signal: AbortSignal.timeout(8000) }
      ).then(r => r.json()).catch(() => null),

      // 7. OpenSea agent binding
      fetch(
        `https://api.opensea.io/api/v2/chain/ethereum/account/${wallet}/nfts?limit=50`,
        {
          headers: { "x-api-key": OPENSEA_KEY, "accept": "application/json" },
          signal:  AbortSignal.timeout(8000),
        }
      ).then(r => r.json()).catch(() => null),
    ]);

    // ── PARSE RESPONSES ────────────────────────────────────────────────────────

    const txData       = ethTxRes.status      === "fulfilled" ? ethTxRes.value      : null;
    const firstTxData  = ethFirstTxRes.status === "fulfilled" ? ethFirstTxRes.value : null;
    const balData      = ethBalRes.status     === "fulfilled" ? ethBalRes.value     : null;
    const internalData = ethInternalRes.status === "fulfilled" ? ethInternalRes.value : null;
    const gbData       = getblockRes.status   === "fulfilled" ? getblockRes.value   : null;
    const nmData       = normiesAgentRes.status === "fulfilled" ? normiesAgentRes.value : null;
    const osData       = openSeaAgentRes.status === "fulfilled" ? openSeaAgentRes.value : null;

    // Transaction list
    const txList = txData?.result && Array.isArray(txData.result) ? txData.result : [];

    // True wallet age
    const firstTxList  = firstTxData?.result && Array.isArray(firstTxData.result) ? firstTxData.result : [];
    const firstTxEver  = firstTxList[0] || null;
    const trueFirstTs  = firstTxEver ? parseInt(firstTxEver.timeStamp) * 1000 : null;
    const trueAgeDays  = trueFirstTs ? Math.floor((Date.now() - trueFirstTs) / 86400000) : 0;
    const trueFirstSeen = trueFirstTs ? new Date(trueFirstTs).toISOString().split("T")[0] : null;

    // Last active
    const newestTx   = txList[0];
    const lastActive  = newestTx
      ? new Date(parseInt(newestTx.timeStamp) * 1000).toISOString().split("T")[0]
      : null;

    // True total tx count
    const trueTotalTx = txList.length;

    // ETH balance
    const rawBalance  = balData?.result && !isNaN(parseInt(balData.result))
      ? parseInt(balData.result) : 0;
    const ethBalance  = (rawBalance / 1e18).toFixed(4);

    // Success rate
    const successTx   = txList.filter((t: any) => t.isError === "0").length;
    const successRate = txList.length > 0 ? successTx / txList.length : 0;

    // Unique contracts
    const uniqueContracts = new Set(
      txList.filter((t: any) => t.to && t.input !== "0x").map((t: any) => t.to)
    ).size;

    // ERC-6551 TBA detection
    const internalTxList = internalData?.result && Array.isArray(internalData.result)
      ? internalData.result : [];
    const hasTBA = internalTxList.some((t: any) =>
      t.from?.toLowerCase() === ERC6551_REGISTRY.toLowerCase() ||
      t.to?.toLowerCase()   === ERC6551_REGISTRY.toLowerCase()
    );

    // Split counterparties into EOA peers vs protocol/contract interactions.
    // Peer transfers have empty input ("0x"); contract calls carry calldata.
    // Known protocol/token addresses are always treated as contracts.
    const allTo = txList.filter((t: any) => t.to && t.to.toLowerCase() !== wallet);

    const protocolInteractions = [...new Set(
      allTo
        .filter((t: any) => t.input !== "0x" || isKnownContract(t.to))
        .map((t: any) => t.to.toLowerCase())
    )] as string[];

    const eoaCounterparties = [...new Set(
      allTo
        .filter((t: any) => t.input === "0x" && !isKnownContract(t.to))
        .map((t: any) => t.to.toLowerCase())
    )].slice(0, 20) as string[];

    // Label any protocol interactions we recognise (for the report).
    const labelledProtocols = protocolInteractions
      .map((a) => { const l = getLabel(a); return l ? { address: a, ...l } : null; })
      .filter(Boolean)
      .slice(0, 10);

    // ── CONTRACT DETECTION (checked address) ───────────────────────────────────
    const knownLabel    = getLabel(wallet);
    const chainId       = network === "base" ? 8453 : network === "polygon" ? 137 : network === "bsc" ? 56 : network === "arbitrum" ? 42161 : 1;
    const addressIsContract = knownLabel ? true : await isContractAddress(wallet, chainId);

    // ── ERC-8257 TOOL USAGE (Base) ─────────────────────────────────────────────
    const erc8257Calls = await getErc8257Usage(wallet);

    // ── WALLET RELATIONSHIP GRAPH (EOA peers only) ─────────────────────────────
    const relationshipGraph = await getRelationshipGraph(wallet, eoaCounterparties);

    // ── COMMUNITY FLAGS ────────────────────────────────────────────────────────
    const [
      endorsementsData,
      outcomesData,
      certsData,
      certDetailsData,
      scopeData,
      prevTrustData,
      communityFlagData,
    ] = await Promise.all([
      redisGet(`agentcheck:endorsements:${wallet}`),
      redisGet(`agentcheck:outcomes:${wallet}`),
      redisGet(`agentcheck:certs:${wallet}`),
      redisGet(`agentcheck:cert_details:${wallet}`),
      redisGet(`agentcheck:scope:${wallet}`),
      redisGet(`agentcheck:prev_trust:${wallet}`),
      redisGet(`agentcheck:flagged:${wallet}`),
    ]);

    const endorseCount   = endorsementsData?.count    || 0;
    const endorseList    = endorsementsData?.list      || [];
    const outcomesPos    = outcomesData?.positive      || 0;
    const outcomesTotal  = outcomesData?.total         || 0;
    const certList       = certsData                   || [];
    const scopeInfo      = scopeData                   || null;
    const prevTrust      = prevTrustData ? parseInt(prevTrustData) : null;
    const isCommunityFlagged = !!communityFlagData;

    // Cert expiry
    const certifiedAt    = certDetailsData?.certified_at || null;
    const certExpired    = certifiedAt
      ? (Date.now() - new Date(certifiedAt).getTime()) > 90 * 24 * 60 * 60 * 1000
      : false;
    const certExpiresAt  = certifiedAt
      ? new Date(new Date(certifiedAt).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const batteryVersion = certDetailsData?.battery_version || null;
    const batteryHash    = certDetailsData?.battery_hash    || null;

    // ── GETBLOCK ───────────────────────────────────────────────────────────────
    const gbRisk       = gbData?.risk_score            ?? null;
    const gbLevel      = gbData?.risk_level            ?? null;
    const gbFlags      = gbData?.flags                 ?? [];
    const gbSanctioned = gbData?.sanctions?.sanctioned ?? false;
    const gbMixer      = gbFlags.includes("mixer_interaction");
    const gbDarkweb    = gbFlags.includes("darkweb_transaction");
    const gbPhishing   = gbFlags.includes("phishing");
    const gbRugPull    = gbFlags.includes("rug_pull");
    const gbNewAddress = gbData?.is_new_address        ?? (trueAgeDays < 30);

    // ── NORMIES / ERC-8004 ─────────────────────────────────────────────────────
    const isErc8004  = !!(nmData && nmData.tokenId && !nmData.error);
    const agentName  = nmData?.name          || null;
    const agentType  = nmData?.type          || null;
    const agentLevel = nmData?.canvas?.level || null;

    // ── OPENSEA AGENT BINDING ──────────────────────────────────────────────────
    let hasAgentBinding   = false;
    let agentCapabilities: string[] = [];

    if (osData?.nfts && Array.isArray(osData.nfts)) {
      const agentNFTs = osData.nfts.filter((nft: any) =>
        nft.agent_binding ||
        nft.metadata?.agent_metadata ||
        nft.traits?.some((t: any) =>
          ["agent","skill","capability","tool"].includes((t.trait_type || "").toLowerCase())
        )
      );
      if (agentNFTs.length > 0) {
        hasAgentBinding = true;
        agentNFTs.forEach((nft: any) => {
          (nft.traits || [])
            .filter((t: any) => ["capability","skill","service","tool"].includes((t.trait_type || "").toLowerCase()))
            .forEach((t: any) => { if (t.value) agentCapabilities.push(t.value); });
        });
        agentCapabilities = [...new Set(agentCapabilities)].slice(0, 10);
      }
    }

    // ── COMPUTE SCORES ─────────────────────────────────────────────────────────

    const { score: trustScore, breakdown: trustBreakdown } = computeTrustScore({
      ageDays:              trueAgeDays,
      totalTx:              trueTotalTx,
      successRate,
      defiProtocols:        Math.min(uniqueContracts, 20),
      endorsements:         endorseCount,
      outcomesPositive:     outcomesPos,
      outcomesTotal,
      erc8257Calls,
      counterpartyAvgScore: relationshipGraph.avgScore,
    });

    // Counterparty risk for risk score — based on EOA peers only.
    // Protocol/contract interactions are excluded (they are not risk signals).
    const flaggedCounterparties = eoaCounterparties.filter(cp =>
      relationshipGraph.details.some(d => d.wallet === cp && d.composite < 30)
    ).length;
    const counterpartyRiskScore = eoaCounterparties.length > 0
      ? Math.round((flaggedCounterparties / eoaCounterparties.length) * 100)
      : 0;

    const { score: riskScore, flags: riskFlags } = computeRiskScore({
      getblockRisk:     gbRisk,
      sanctioned:       gbSanctioned,
      mixerInteraction: gbMixer,
      darkwebFlag:      gbDarkweb,
      phishingFlag:     gbPhishing,
      rugPullFlag:      gbRugPull,
      newAddress:       gbNewAddress,
      communityFlagged: isCommunityFlagged,
      counterpartyRisk: counterpartyRiskScore,
    });

    const { score: agentScore, highlights: agentHighlights } = computeAgentScore({
      isErc8004,
      agentName,
      agentType,
      agentLevel,
      hasAgentBinding,
      agentCapabilities,
      hasTBA,
      erc8257Calls,
      certifications: certList,
      certExpired,
    });

    const rawComposite = compositeScore(trustScore, riskScore, agentScore);
    const hasRealHistory = trueAgeDays >= 30 && trueTotalTx >= 5;
    const hasSeriousFlag = gbSanctioned || gbMixer || gbDarkweb || gbPhishing || gbRugPull || isCommunityFlagged;
    const adjustedComposite = (hasRealHistory && !hasSeriousFlag)
      ? Math.max(rawComposite, 50)
      : rawComposite;

    const rating       = compositeToLetter(adjustedComposite);
    // Contract-aware verdict: a labelled/verified contract is infrastructure,
    // not a personal wallet to "trust with funds" in the same sense.
    let verdict = letterToVerdict(rating, isErc8004 || hasAgentBinding);
    if (knownLabel) {
      verdict = `Known ${knownLabel.type}: ${knownLabel.label}. ` +
        (knownLabel.verified
          ? "Recognised, verified address. Treat as infrastructure, not a peer wallet."
          : "Recognised address. Verify intent before transacting.");
    } else if (addressIsContract) {
      verdict = `This address is a smart contract, not an EOA wallet. ` +
        `Wallet-history trust signals apply differently — evaluate the contract's ` +
        `verification, usage, and audit status rather than 'who it transacts with'.`;
    }
    const scoreOutlook = outlookCalc(trustScore, prevTrust);

    // ── HIGHLIGHTS ─────────────────────────────────────────────────────────────
    const highlights: string[] = [];
    if (knownLabel)               highlights.push(`✓ Identified: ${knownLabel.label} (${knownLabel.type}${knownLabel.verified ? ", verified" : ""})`);
    else if (addressIsContract)   highlights.push("◆ This address is a smart contract, not an EOA wallet");
    if (trueAgeDays > 0)          highlights.push(`${addressIsContract ? "Contract" : "Wallet"} active ${trueAgeDays} days since ${trueFirstSeen}`);
    if (trueTotalTx > 0)          highlights.push(`${trueTotalTx} transactions · ${Math.round(successRate * 100)}% success rate`);
    if (labelledProtocols.length > 0) highlights.push(`Interacts with ${labelledProtocols.length} known protocol${labelledProtocols.length > 1 ? "s" : ""}: ${labelledProtocols.map((p: any) => p.label).slice(0, 3).join(", ")}`);
    if (parseFloat(ethBalance) > 0) highlights.push(`Balance: ${ethBalance} ETH`);
    if (uniqueContracts > 0)      highlights.push(`${uniqueContracts} unique contracts`);
    if (hasTBA)                   highlights.push("ERC-6551 Token Bound Account confirmed");
    if (erc8257Calls > 0)         highlights.push(`${erc8257Calls} ERC-8257 registry interactions on Base`);
    if (endorseCount > 0)         highlights.push(`${endorseCount} community endorsements`);
    if (outcomesTotal > 0)        highlights.push(`${outcomesPos}/${outcomesTotal} outcomes positive`);
    if (relationshipGraph.checkedCount > 0) {
      highlights.push(
        `EOA peer graph: ${relationshipGraph.trustedCount}/${relationshipGraph.checkedCount} trusted` +
        (relationshipGraph.riskyCount > 0 ? `, ${relationshipGraph.riskyCount} risky` : "")
      );
    }
    if (isCommunityFlagged) highlights.push("⚠ Community flagged as malicious");
    highlights.push(...agentHighlights);

    // ── STORE IN REDIS ─────────────────────────────────────────────────────────
    const checkRecord = {
      wallet, network, source,
      trust_score:  trustScore,
      risk_score:   riskScore,
      agent_score:  agentScore,
      composite:    adjustedComposite,
      rating,
      ts:           Date.now(),
    };

    await Promise.all([
      redisPush(`agentcheck:history:${wallet}`, checkRecord),
      redisSet(`agentcheck:prev_trust:${wallet}`, trustScore.toString()),
      redisIncr("agentcheck:total_checks"),
      // Track source
      redisIncr(`agentcheck:calls:${source}`),
      // Rating distribution counter (for /api/stats)
      incrRatingCounter(rating),
    ]);

    // ── RESPONSE ───────────────────────────────────────────────────────────────
    return res.status(200).json({
      wallet,
      network,
      source,
      rating,
      outlook:    scoreOutlook,
      verdict,
      checked_at: new Date().toISOString(),

      address_type: {
        is_contract: addressIsContract,
        is_eoa:      !addressIsContract,
        known:       !!knownLabel,
        label:       knownLabel ? knownLabel.label : null,
        category:    knownLabel ? knownLabel.type : (addressIsContract ? "unlabelled-contract" : "eoa"),
        verified:    knownLabel ? knownLabel.verified : false,
      },

      trust_score: trustScore,
      risk_score:  riskScore,
      agent_score: agentScore,
      composite:   adjustedComposite,

      report: {
        highlights,
        risk_flags:      hasSeriousFlag ? riskFlags : [],
        trust_breakdown: trustBreakdown,

        wallet_data: {
          address_type:       addressIsContract ? "contract" : "eoa",
          identified_as:      knownLabel ? knownLabel.label : null,
          age_days:           trueAgeDays,
          first_seen:         trueFirstSeen,
          last_active:        lastActive,
          total_transactions: trueTotalTx,
          success_rate:       `${Math.round(successRate * 100)}%`,
          eth_balance:        `${ethBalance} ETH`,
          unique_contracts:   uniqueContracts,
          tba_wallet:         hasTBA,
          data_source:        "Etherscan v2 Pro",
        },

        protocol_interactions: {
          count:      labelledProtocols.length,
          recognised: labelledProtocols,
          note: labelledProtocols.length > 0
            ? "Known protocol/token contracts this address has interacted with. These are excluded from the EOA peer trust graph."
            : "No recognised protocol interactions among recent transactions.",
        },

        erc8257_activity: {
          registry_calls:   erc8257Calls,
          registry_address: ERC8257_REGISTRY,
          network:          "Base",
          note: erc8257Calls > 0
            ? `${erc8257Calls} verified interactions with ERC-8257 registry on Base`
            : "No ERC-8257 registry interactions detected on Base",
        },

        relationship_graph: {
          scope: "EOA peers only — protocol/contract interactions excluded",
          eoa_counterparties_analysed: relationshipGraph.checkedCount,
          average_counterparty_score: relationshipGraph.avgScore,
          trusted_counterparties: relationshipGraph.trustedCount,
          risky_counterparties:   relationshipGraph.riskyCount,
          top_counterparties:     relationshipGraph.details,
          interpretation: relationshipGraph.checkedCount === 0
            ? "No peer-to-peer EOA counterparties found — this address interacts mainly with contracts/protocols, which is normal for active DeFi users and contracts. Not a negative signal."
            : relationshipGraph.avgScore >= 60
            ? "Transacts primarily with trusted EOA peers"
            : relationshipGraph.avgScore >= 40
            ? "Mixed EOA peer quality — some risky peers"
            : "High-risk EOA peer network detected",
        },

        forensics: {
          provider:         "GetBlock Fraud Check",
          risk_level:       gbLevel || (riskScore < 30 ? "LOW" : riskScore < 60 ? "MEDIUM" : "HIGH"),
          flags:            riskFlags,
          sanctioned:       gbSanctioned,
          community_flagged: isCommunityFlagged,
        },

        agent_identity: {
          is_agent:           isErc8004 || hasAgentBinding,
          erc8004_registered: isErc8004,
          agent_binding:      hasAgentBinding,
          tba_confirmed:      hasTBA,
          name:               agentName,
          type:               agentType,
          level:              agentLevel,
          capabilities:       agentCapabilities,
        },

        certifications: {
          passed:           certList,
          expired:          certExpired,
          certified_at:     certifiedAt,
          expires_at:       certExpiresAt,
          battery_version:  batteryVersion,
          battery_hash:     batteryHash,
          pending:          ["prompt_injection", "secret_protection", "unsafe_action"]
            .filter(c => !certList.includes(c)),
          note: certList.length === 0
            ? "No safety certifications. Submit via POST /api/certify."
            : certExpired
            ? "Certifications EXPIRED. Recertify via POST /api/certify."
            : `${certList.length}/3 certifications valid until ${certExpiresAt?.split("T")[0]}.`,
        },

        community: {
          endorsements:      endorseCount,
          endorsers:         endorseList.slice(0, 5),
          outcomes_tracked:  outcomesTotal,
          positive_outcomes: outcomesPos,
        },

        permission_scope: scopeInfo || {
          declared: false,
          note:     "No permission scope declared. Submit via POST /api/scope.",
        },

        data_freshness: {
          checked_at:   new Date().toISOString(),
          age_seconds:  0,
          sources: {
            etherscan:  "live — latest block state",
            getblock:   "live — real-time forensics",
            opensea:    "live — real-time agent binding",
            redis:      "live — exact moment of call",
            base_rpc:   "live — ERC-8257 activity",
          },
          recommended_ttl: {
            low_value_decisions:  "300 seconds",
            high_value_decisions: "30 seconds — re-check before executing",
            atomic_enforcement:   "use isCertified() on-chain directly",
          },
          cert_registry: "0x803A8988E40CBb54897e5782A6A589d907A5B03A",
          staleness_note: "Composite score is point-in-time. For atomic enforcement use isCertified() directly.",
        },

        how_to_improve: {
          automatic: [
            "Wallet age increases naturally",
            "Each successful transaction adds volume score",
            "Transacting with trusted counterparties improves relationship graph",
            "Using ERC-8257 tools on Base adds tool usage score",
          ],
          actions: [
            "Get endorsed: POST /api/endorse",
            "Report positive outcomes: POST /api/outcome",
            "Declare permission scope: POST /api/scope",
            "Register as ERC-8004 agent for +25 agent score",
            "Pass safety certifications: POST /api/certify",
          ],
          methodology_url: "https://agentcheck-bice.vercel.app/api/methodology",
        },
      },

      human_report: `https://agentcheck-bice.vercel.app/api/report?wallet=${wallet}`,
      methodology:  "https://agentcheck-bice.vercel.app/api/methodology",
      powered_by:   [
        "Etherscan v2 Pro",
        "GetBlock Fraud Check",
        "Normies ERC-8004 Registry",
        "OpenSea Agent API",
        "AgentCheck Community",
        "Base RPC (ERC-8257 activity)",
      ],
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
