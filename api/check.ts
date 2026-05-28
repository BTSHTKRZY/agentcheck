import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ETHERSCAN_KEY    = process.env.ETHERSCAN_API_KEY    || "";
const GETBLOCK_KEY     = process.env.GETBLOCK_API_KEY     || "";
const OPENSEA_KEY      = process.env.OPENSEA_API_KEY      || "";
const NORMIES_API      = "https://api.normies.art";
const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";

// ERC-6551 registry contract — deployed on Ethereum mainnet
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";

// Known x402 payment contract addresses
const X402_CONTRACTS = [
  "0x1337def18c680af1f9f45cbcab6309562975b1dd", // x402 mainnet
];

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
  const entity = isAgent ? "agent" : "wallet";
  switch (letter) {
    case "AAA": return `Exceptional ${entity}. Highest trust. Safe to transact.`;
    case "AA":  return `Strong ${entity}. Established track record. Safe to transact.`;
    case "A":   return `Good ${entity}. Solid history. Generally safe to transact.`;
    case "BBB": return `Adequate ${entity}. Limited history but no adverse flags.`;
    case "BB":  return `Speculative ${entity}. Proceed with caution and smaller amounts.`;
    case "B":   return `Weak ${entity}. Significant gaps or minor concerns. Exercise caution.`;
    case "CCC": return `Poor ${entity}. Active risk flags present. Avoid high-value transactions.`;
    case "CC":  return `Very poor ${entity}. Multiple serious flags. Do not transact.`;
    case "C":   return `High risk. Known adverse activity. Do not transact.`;
    case "D":   return `Defaulted or confirmed malicious. Do not transact under any circumstances.`;
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
  ageDays:          number;
  totalTx:          number;
  successRate:      number;
  defiProtocols:    number;
  paymentHistory:   number;
  erc8257Usage:     number;
  endorsements:     number;
  outcomesPositive: number;
  outcomesTotal:    number;
  x402Payments:     number;
}): { score: number; breakdown: Record<string, number> } {

  // Wallet age (max 15)
  const ageScore =
    data.ageDays > 1460 ? 15 :  // 4+ years
    data.ageDays > 730  ? 13 :  // 2+ years
    data.ageDays > 365  ? 11 :  // 1+ year
    data.ageDays > 180  ? 8  :
    data.ageDays > 90   ? 5  :
    data.ageDays > 30   ? 2  : 0;

  // Transaction volume (max 15) — logarithmic, now benefits from Pro full history
  const txScore = Math.min(15, Math.floor(Math.log10(Math.max(1, data.totalTx)) * 4));

  // Success rate (max 20)
  const successScore =
    data.successRate >= 0.99 ? 20 :
    data.successRate >= 0.97 ? 18 :
    data.successRate >= 0.95 ? 15 :
    data.successRate >= 0.90 ? 10 :
    data.successRate >= 0.80 ? 5  : 0;

  // DeFi protocol diversity (max 10)
  const defiScore    = Math.min(10, data.defiProtocols * 2);

  // x402 payment history (max 10) — now wired up
  const x402Score    = Math.min(10, data.x402Payments * 2);

  // ERC-8257 tool usage (max 10)
  const toolScore    = Math.min(10, data.erc8257Usage * 2);

  // Community endorsements (max 10)
  const endorseScore = Math.min(10, data.endorsements * 3);

  // Outcome tracking (max 5)
  const outcomeScore = data.outcomesTotal > 0
    ? Math.round((data.outcomesPositive / data.outcomesTotal) * 5)
    : 0;

  const score = ageScore + txScore + successScore + defiScore +
                x402Score + toolScore + endorseScore + outcomeScore;

  return {
    score: Math.min(100, score),
    breakdown: {
      wallet_age:         ageScore,
      transaction_volume: txScore,
      success_rate:       successScore,
      defi_diversity:     defiScore,
      x402_payments:      x402Score,
      tool_usage:         toolScore,
      endorsements:       endorseScore,
      outcome_accuracy:   outcomeScore,
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
  counterpartyRisk:    number; // 0-100, avg risk of top counterparties
}): { score: number; flags: string[] } {

  let score = data.getblockRisk ?? 20;
  const flags: string[] = [];

  if (data.sanctioned)         { score = 100; flags.push("sanctioned_entity"); }
  if (data.darkwebFlag)        { score = Math.max(score, 90); flags.push("darkweb_interaction"); }
  if (data.phishingFlag)       { score = Math.max(score, 80); flags.push("phishing_association"); }
  if (data.rugPullFlag)        { score = Math.max(score, 85); flags.push("rug_pull_history"); }
  if (data.mixerInteraction)   { score = Math.max(score, 75); flags.push("mixer_interaction"); }
  if (data.communityFlagged)   { score = Math.max(score, 70); flags.push("community_flagged"); }
  if (data.counterpartyRisk > 60) {
    score = Math.max(score, 50);
    flags.push(`high_risk_counterparties (avg risk: ${data.counterpartyRisk})`);
  }
  if (data.newAddress)         { flags.push("new_address_limited_history"); }

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
  agentTxCount:       number;
  certifications:     string[];
  certExpired:        boolean;
  socialLinked:       boolean;
}): { score: number; highlights: string[] } {

  let score = 0;
  const highlights: string[] = [];

  if (data.isErc8004) {
    score += 25;
    highlights.push(`ERC-8004 registered agent${data.agentName ? ` — ${data.agentName}` : ""}${data.agentType ? ` (${data.agentType})` : ""}`);
  }
  if (data.hasAgentBinding) {
    score += 15;
    highlights.push("ERC-8004 agent binding confirmed via OpenSea API");
  }
  if (data.agentCapabilities.length > 0) {
    score += Math.min(10, data.agentCapabilities.length * 2);
    highlights.push(`Declared capabilities: ${data.agentCapabilities.slice(0, 3).join(", ")}`);
  }
  if (data.hasTBA) {
    score += 15;
    highlights.push("ERC-6551 Token Bound Account — autonomous wallet confirmed");
  }
  if (data.erc8257Calls > 0) {
    const s = Math.min(15, data.erc8257Calls * 4);
    score += s;
    highlights.push(`${data.erc8257Calls} ERC-8257 tool interactions`);
  }
  if (data.agentTxCount > 0) {
    score += Math.min(10, data.agentTxCount * 3);
    highlights.push(`${data.agentTxCount} agent-to-agent transactions`);
  }

  // Certifications — 5 points each but only if not expired
  if (data.certifications.length > 0 && !data.certExpired) {
    const s = Math.min(15, data.certifications.length * 5);
    score += s;
    highlights.push(`Safety certified: ${data.certifications.join(", ").replace(/_/g, " ")}`);
  } else if (data.certifications.length > 0 && data.certExpired) {
    highlights.push("Safety certifications EXPIRED — recertification required");
  }

  if (data.socialLinked) highlights.push("Social presence linked");

  return { score: Math.min(100, score), highlights };
}

// ── COMPOSITE ─────────────────────────────────────────────────────────────────

function compositeScore(trust: number, risk: number, agent: number): number {
  return Math.round(trust * 0.5 + (100 - risk) * 0.3 + agent * 0.2);
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

  const wallet: string = (
    req.query?.wallet || req.body?.wallet || ""
  ).toString().toLowerCase().trim();

  const network: string = (
    req.query?.network || req.body?.network || "eth"
  ).toString().toLowerCase();

  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
    return res.status(400).json({
      error: "Invalid wallet address. Provide a valid 0x Ethereum address.",
    });
  }

  try {
    const [
      // Etherscan Pro — full history (no offset limit with Pro)
      ethTxRes,
      ethTxCountRes,
      ethBalRes,
      ethFirstTxRes,
      ethInternalRes,
      getblockRes,
      normiesAgentRes,
      openSeaAgentRes,
      endorsementsRes,
      outcomesRes,
      certRes,
      certDetailsRes,
      scopeRes,
      prevScoreRes,
      communityFlagRes,
    ] = await Promise.allSettled([

      // 1. Etherscan — recent 200 transactions (Pro allows higher offset)
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=200&sort=desc&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 2. Etherscan — total transaction count via txlistinternal trick
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=proxy&action=eth_getTransactionCount&address=${wallet}&tag=latest&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 3. Etherscan — ETH balance
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance&address=${wallet}&tag=latest&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 4. Etherscan — FIRST ever transaction (sort=asc, offset=1) for true wallet age
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 5. Etherscan — internal transactions (ERC-6551 TBA detection + x402)
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlistinternal&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 6. GetBlock — fraud check
      fetch(
        `https://hub-api.getblock.io/wallet-risk/fraudCheck`,
        {
          method: "POST",
          headers: { "x-api-key": GETBLOCK_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ address: wallet, network }),
        }
      ).then(r => r.json()).catch(() => null),

      // 7. Normies — ERC-8004 agent identity
      fetch(`${NORMIES_API}/agents/info/${wallet}`).then(r => r.json()).catch(() => null),

      // 8. OpenSea — agent binding check
      fetch(
        `https://api.opensea.io/api/v2/chain/ethereum/account/${wallet}/nfts?limit=50`,
        { headers: { "x-api-key": OPENSEA_KEY, "accept": "application/json" } }
      ).then(r => r.json()).catch(() => null),

      // 9. Redis — endorsements
      redis.get(`agentcheck:endorsements:${wallet}`).catch(() => null),

      // 10. Redis — outcomes
      redis.get(`agentcheck:outcomes:${wallet}`).catch(() => null),

      // 11. Redis — certifications list
      redis.get(`agentcheck:certs:${wallet}`).catch(() => null),

      // 12. Redis — certification details (includes expiry)
      redis.get(`agentcheck:cert_details:${wallet}`).catch(() => null),

      // 13. Redis — permission scope
      redis.get(`agentcheck:scope:${wallet}`).catch(() => null),

      // 14. Redis — previous trust score
      redis.get(`agentcheck:prev_trust:${wallet}`).catch(() => null),

      // 15. Redis — community flag
      redis.get(`agentcheck:flagged:${wallet}`).catch(() => null),
    ]);

    // ── PARSE ETHERSCAN ─────────────────────────────────────────────────────

    const txData       = ethTxRes.status      === "fulfilled" ? ethTxRes.value      : null;
    const txCountData  = ethTxCountRes.status === "fulfilled" ? ethTxCountRes.value : null;
    const balData      = ethBalRes.status     === "fulfilled" ? ethBalRes.value     : null;
    const firstTxData  = ethFirstTxRes.status === "fulfilled" ? ethFirstTxRes.value : null;
    const internalData = ethInternalRes.status === "fulfilled" ? ethInternalRes.value : null;
    const gbData       = getblockRes.status   === "fulfilled" ? getblockRes.value   : null;
    const nmData       = normiesAgentRes.status === "fulfilled" ? normiesAgentRes.value : null;
    const osData       = openSeaAgentRes.status === "fulfilled" ? openSeaAgentRes.value : null;

    const endorsements  = endorsementsRes.status  === "fulfilled" ? endorsementsRes.value  : null;
    const outcomes      = outcomesRes.status      === "fulfilled" ? outcomesRes.value      : null;
    const certs         = certRes.status          === "fulfilled" ? certRes.value          : null;
    const certDetails   = certDetailsRes.status   === "fulfilled" ? certDetailsRes.value   : null;
    const scope         = scopeRes.status         === "fulfilled" ? scopeRes.value         : null;
    const prevTrust     = prevScoreRes.status     === "fulfilled" ? prevScoreRes.value     : null;
    const communityFlag = communityFlagRes.status === "fulfilled" ? communityFlagRes.value : null;

    // Recent transactions (up to 200 with Pro)
    const txList = txData?.result && Array.isArray(txData.result) ? txData.result : [];

    // True total transaction count from eth_getTransactionCount
    const trueTotalTx = txCountData?.result
      ? parseInt(txCountData.result, 16)
      : txList.length;

    // ETH balance
    const rawBalance = balData?.result && !isNaN(parseInt(balData.result))
      ? parseInt(balData.result) : 0;
    const ethBalance = (rawBalance / 1e18).toFixed(4);

    // TRUE wallet age from first-ever transaction (separate API call)
    const firstTxList  = firstTxData?.result && Array.isArray(firstTxData.result)
      ? firstTxData.result : [];
    const firstTxEver  = firstTxList[0] || null;
    const trueFirstTs  = firstTxEver ? parseInt(firstTxEver.timeStamp) * 1000 : null;
    const trueAgeDays  = trueFirstTs
      ? Math.floor((Date.now() - trueFirstTs) / 86400000)
      : 0;
    const trueFirstSeen = trueFirstTs
      ? new Date(trueFirstTs).toISOString().split("T")[0]
      : null;

    // Last active from most recent transaction
    const newestTx   = txList[0];
    const lastActive  = newestTx
      ? new Date(parseInt(newestTx.timeStamp) * 1000).toISOString().split("T")[0]
      : null;

    // Success rate from recent transactions
    const successTx   = txList.filter((t: any) => t.isError === "0").length;
    const successRate  = txList.length > 0 ? successTx / txList.length : 0;

    // Unique contracts (DeFi diversity)
    const uniqueContracts = new Set(
      txList.filter((t: any) => t.to && t.input !== "0x").map((t: any) => t.to)
    ).size;

    // ── ERC-6551 TBA DETECTION ──────────────────────────────────────────────

    // Check if this wallet was created by the ERC-6551 registry
    const internalTxList = internalData?.result && Array.isArray(internalData.result)
      ? internalData.result : [];

    const hasTBA = internalTxList.some((t: any) =>
      t.from?.toLowerCase() === ERC6551_REGISTRY.toLowerCase() ||
      t.to?.toLowerCase()   === ERC6551_REGISTRY.toLowerCase()
    );

    // ── x402 PAYMENT DETECTION ──────────────────────────────────────────────

    const x402Payments = txList.filter((t: any) =>
      X402_CONTRACTS.some(c => t.to?.toLowerCase() === c.toLowerCase())
    ).length;

    // Also check internal transactions for x402
    const x402Internal = internalTxList.filter((t: any) =>
      X402_CONTRACTS.some(c => t.to?.toLowerCase() === c.toLowerCase())
    ).length;

    const totalX402 = x402Payments + x402Internal;

    // ── COUNTERPARTY RISK CHECK ─────────────────────────────────────────────

    // Get unique counterparties from recent transactions
    const counterparties = [...new Set(
      txList
        .filter((t: any) => t.to && t.to !== wallet)
        .map((t: any) => t.to.toLowerCase())
    )].slice(0, 20);

    // Check how many counterparties are in our flagged list
    let flaggedCounterparties = 0;
    if (counterparties.length > 0) {
      const flagChecks = await Promise.allSettled(
        counterparties.map(cp =>
          redis.get(`agentcheck:flagged:${cp}`).catch(() => null)
        )
      );
      flaggedCounterparties = flagChecks.filter(
        r => r.status === "fulfilled" && r.value !== null
      ).length;
    }

    const counterpartyRiskScore = counterparties.length > 0
      ? Math.round((flaggedCounterparties / counterparties.length) * 100)
      : 0;

    // ── OPENSEA ERC-8004/8217 BINDING ──────────────────────────────────────

    let hasAgentBinding   = false;
    let agentCapabilities: string[] = [];

    if (osData?.nfts && Array.isArray(osData.nfts)) {
      const agentNFTs = osData.nfts.filter((nft: any) =>
        nft.agent_binding ||
        nft.metadata?.agent_metadata ||
        nft.traits?.some((t: any) =>
          ["agent","skill","capability","tool"].includes(
            (t.trait_type || "").toLowerCase()
          )
        )
      );
      if (agentNFTs.length > 0) {
        hasAgentBinding = true;
        agentNFTs.forEach((nft: any) => {
          (nft.traits || [])
            .filter((t: any) => ["capability","skill","service","tool"].includes(
              (t.trait_type || "").toLowerCase()
            ))
            .forEach((t: any) => { if (t.value) agentCapabilities.push(t.value); });
        });
        agentCapabilities = [...new Set(agentCapabilities)].slice(0, 10);
      }
    }

    // ── GETBLOCK ───────────────────────────────────────────────────────────

    const gbRisk       = gbData?.risk_score            ?? null;
    const gbLevel      = gbData?.risk_level            ?? null;
    const gbFlags      = gbData?.flags                 ?? [];
    const gbSanctioned = gbData?.sanctions?.sanctioned ?? false;
    const gbMixer      = gbFlags.includes("mixer_interaction");
    const gbDarkweb    = gbFlags.includes("darkweb_transaction");
    const gbPhishing   = gbFlags.includes("phishing");
    const gbRugPull    = gbFlags.includes("rug_pull");
    const gbNewAddress = gbData?.is_new_address        ?? (trueAgeDays < 30);

    // ── NORMIES / ERC-8004 ─────────────────────────────────────────────────

    const isErc8004  = !!(nmData && nmData.tokenId && !nmData.error);
    const agentName  = nmData?.name          || null;
    const agentType  = nmData?.type          || null;
    const agentLevel = nmData?.canvas?.level || null;

    // ── REDIS ──────────────────────────────────────────────────────────────

    const endorseCount   = endorsements ? (endorsements as any).count    || 0  : 0;
    const endorseList    = endorsements ? (endorsements as any).list     || [] : [];
    const outcomesPos    = outcomes     ? (outcomes as any).positive     || 0  : 0;
    const outcomesTotal  = outcomes     ? (outcomes as any).total        || 0  : 0;
    const certList       = certs        ? (certs as string[])                  : [];
    const scopeData      = scope        ? (scope as any)                       : null;
    const prevTrustScore = prevTrust    ? parseInt(prevTrust as string)        : null;
    const isCommunityFlagged = !!communityFlag;

    // Certification expiry check
    const certDetailsObj  = certDetails ? (certDetails as any) : null;
    const certifiedAt     = certDetailsObj?.certified_at || null;
    const certExpired     = certifiedAt
      ? (Date.now() - new Date(certifiedAt).getTime()) > 90 * 24 * 60 * 60 * 1000
      : false;
    const certExpiresAt   = certifiedAt
      ? new Date(new Date(certifiedAt).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const certBatteryVersion = certDetailsObj?.battery_version || "1.0";

    // ── COMPUTE SCORES ─────────────────────────────────────────────────────

    const { score: trustScore, breakdown: trustBreakdown } = computeTrustScore({
      ageDays:          trueAgeDays,
      totalTx:          trueTotalTx,
      successRate,
      defiProtocols:    Math.min(uniqueContracts, 20),
      paymentHistory:   0,
      erc8257Usage:     0,
      endorsements:     endorseCount,
      outcomesPositive: outcomesPos,
      outcomesTotal,
      x402Payments:     totalX402,
    });

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
      erc8257Calls:  0,
      agentTxCount:  0,
      certifications: certList,
      certExpired,
      socialLinked:  false,
    });

    const rawComposite = compositeScore(trustScore, riskScore, agentScore);

    const hasRealHistory = trueAgeDays > 0 && trueTotalTx > 0;
    const hasSeriousFlag = gbSanctioned || gbMixer || gbDarkweb || gbPhishing || gbRugPull || isCommunityFlagged;
    const adjustedComposite = (hasRealHistory && !hasSeriousFlag)
      ? Math.max(rawComposite, 50)
      : rawComposite;

    const rating       = compositeToLetter(adjustedComposite);
    const verdict      = letterToVerdict(rating, isErc8004 || hasAgentBinding);
    const scoreOutlook = outlookCalc(trustScore, prevTrustScore);

    // ── HIGHLIGHTS ─────────────────────────────────────────────────────────

    const highlights: string[] = [];
    if (trueAgeDays > 0)              highlights.push(`Wallet active ${trueAgeDays} days since ${trueFirstSeen}`);
    if (trueTotalTx > 0)              highlights.push(`${trueTotalTx} total transactions · ${Math.round(successRate * 100)}% success rate`);
    if (parseFloat(ethBalance) > 0)   highlights.push(`Current balance: ${ethBalance} ETH`);
    if (uniqueContracts > 0)          highlights.push(`${uniqueContracts} unique contracts interacted with`);
    if (hasTBA)                       highlights.push("ERC-6551 Token Bound Account confirmed");
    if (totalX402 > 0)                highlights.push(`${totalX402} x402 micropayments detected`);
    if (endorseCount > 0)             highlights.push(`${endorseCount} community endorsements`);
    if (outcomesTotal > 0)            highlights.push(`${outcomesPos}/${outcomesTotal} verified transactions positive`);
    if (counterpartyRiskScore > 40)   highlights.push(`⚠ ${flaggedCounterparties}/${counterparties.length} recent counterparties flagged`);
    if (isCommunityFlagged)           highlights.push("⚠ Community flagged as malicious");
    highlights.push(...agentHighlights);

    // ── STORE ──────────────────────────────────────────────────────────────

    const checkRecord = {
      wallet, network,
      trust_score:  trustScore,
      risk_score:   riskScore,
      agent_score:  agentScore,
      composite:    adjustedComposite,
      rating,
      ts:           Date.now(),
    };

    Promise.all([
      redis.lpush(`agentcheck:history:${wallet}`, JSON.stringify(checkRecord)),
      redis.ltrim(`agentcheck:history:${wallet}`, 0, 99),
      redis.set(`agentcheck:prev_trust:${wallet}`, trustScore.toString()),
      redis.incr("agentcheck:total_checks"),
    ]).catch(() => {});

    // ── RESPONSE ───────────────────────────────────────────────────────────

    return res.status(200).json({
      wallet,
      network,
      rating,
      outlook:    scoreOutlook,
      verdict,
      checked_at: new Date().toISOString(),

      trust_score: trustScore,
      risk_score:  riskScore,
      agent_score: agentScore,
      composite:   adjustedComposite,

      report: {
        highlights,
        risk_flags:      hasSeriousFlag ? riskFlags : [],
        trust_breakdown: trustBreakdown,

        wallet_data: {
          age_days:           trueAgeDays,
          first_seen:         trueFirstSeen,
          last_active:        lastActive,
          total_transactions: trueTotalTx,
          recent_sample:      txList.length,
          success_rate:       `${Math.round(successRate * 100)}%`,
          eth_balance:        `${ethBalance} ETH`,
          unique_contracts:   uniqueContracts,
          x402_payments:      totalX402,
          tba_wallet:         hasTBA,
          data_source:        "Etherscan v2",
        },

        counterparty_analysis: {
          counterparties_checked:  counterparties.length,
          flagged_counterparties:  flaggedCounterparties,
          counterparty_risk_score: counterpartyRiskScore,
          note: flaggedCounterparties > 0
            ? `${flaggedCounterparties} of your recent counterparties have been flagged by the community`
            : "No flagged counterparties detected",
        },

        forensics: {
          provider:   "GetBlock Fraud Check",
          risk_level: gbLevel || (riskScore < 30 ? "LOW" : riskScore < 60 ? "MEDIUM" : "HIGH"),
          flags:      riskFlags,
          sanctioned: gbSanctioned,
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
          note: !isErc8004 && !hasAgentBinding
            ? "Not a registered ERC-8004 agent"
            : "Registered agent with on-chain identity",
        },

        certifications: {
          passed:           certList,
          expired:          certExpired,
          certified_at:     certifiedAt,
          expires_at:       certExpiresAt,
          battery_version:  certBatteryVersion,
          pending:          ["prompt_injection", "secret_protection", "unsafe_action_gating"]
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

        permission_scope: scopeData || {
          declared: false,
          note:     "No permission scope declared. Submit via POST /api/scope.",
        },

        how_to_improve: {
          automatic: [
            "Wallet age increases naturally over time",
            "Each successful transaction adds to volume score",
            "Interacting with more protocols increases diversity score",
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
      powered_by:   ["Etherscan v2", "GetBlock Fraud Check", "Normies ERC-8004 Registry", "OpenSea Agent API", "AgentCheck Community"],
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
