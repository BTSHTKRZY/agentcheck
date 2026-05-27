import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ETHERSCAN_KEY  = process.env.ETHERSCAN_API_KEY || "";
const GETBLOCK_KEY   = process.env.GETBLOCK_API_KEY  || "";
const NORMIES_API    = "https://api.normies.art";

// ── RATING SCALE ──────────────────────────────────────────────────────────────

function compositeToLetter(composite: number): string {
  if (composite >= 93) return "AAA";
  if (composite >= 85) return "AA";
  if (composite >= 77) return "A";
  if (composite >= 69) return "BBB";
  if (composite >= 61) return "BB";
  if (composite >= 53) return "B";
  if (composite >= 40) return "CCC";
  if (composite >= 25) return "CC";
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

function outlook(trust: number, prev: number | null): string {
  if (prev === null) return "stable";
  const delta = trust - prev;
  if (delta > 5)  return "positive";
  if (delta < -5) return "negative";
  return "stable";
}

// ── TRUST SCORE (0-100) ───────────────────────────────────────────────────────

function computeTrustScore(data: {
  ageDays:           number;
  totalTx:           number;
  successRate:       number;
  defiProtocols:     number;
  paymentHistory:    number;
  erc8257Usage:      number;
  endorsements:      number;
  outcomesPositive:  number;
  outcomesTotal:     number;
}): { score: number; breakdown: Record<string, number> } {

  // Wallet age (max 15)
  const ageScore =
    data.ageDays > 730  ? 15 :
    data.ageDays > 365  ? 12 :
    data.ageDays > 180  ? 9  :
    data.ageDays > 90   ? 6  :
    data.ageDays > 30   ? 3  : 0;

  // Transaction volume (max 15) — logarithmic
  const txScore = Math.min(15, Math.floor(Math.log10(Math.max(1, data.totalTx)) * 5));

  // Transaction success rate (max 20)
  const successScore =
    data.successRate >= 0.98 ? 20 :
    data.successRate >= 0.95 ? 16 :
    data.successRate >= 0.90 ? 12 :
    data.successRate >= 0.80 ? 6  : 0;

  // DeFi protocol diversity (max 10)
  const defiScore = Math.min(10, data.defiProtocols * 2);

  // Payment history — x402, subscriptions (max 15)
  const paymentScore = Math.min(15, data.paymentHistory * 3);

  // ERC-8257 tool usage (max 10)
  const toolScore = Math.min(10, data.erc8257Usage * 2);

  // Community endorsements (max 10)
  const endorseScore = Math.min(10, data.endorsements * 3);

  // Outcome tracking — historical accuracy (max 5)
  const outcomeScore = data.outcomesTotal > 0
    ? Math.round((data.outcomesPositive / data.outcomesTotal) * 5)
    : 0;

  const score = ageScore + txScore + successScore + defiScore +
                paymentScore + toolScore + endorseScore + outcomeScore;

  return {
    score: Math.min(100, score),
    breakdown: {
      wallet_age:         ageScore,
      transaction_volume: txScore,
      success_rate:       successScore,
      defi_diversity:     defiScore,
      payment_history:    paymentScore,
      tool_usage:         toolScore,
      endorsements:       endorseScore,
      outcome_accuracy:   outcomeScore,
    },
  };
}

// ── RISK SCORE (0-100, lower = safer) ────────────────────────────────────────

function computeRiskScore(data: {
  getblockRisk:    number | null;
  sanctioned:      boolean;
  mixerInteraction: boolean;
  darkwebFlag:     boolean;
  phishingFlag:    boolean;
  rugPullFlag:     boolean;
  newAddress:      boolean;
}): { score: number; flags: string[] } {

  let score  = data.getblockRisk ?? 20; // default moderate if no data
  const flags: string[] = [];

  if (data.sanctioned)       { score = 100; flags.push("sanctioned_entity"); }
  if (data.darkwebFlag)      { score = Math.max(score, 90); flags.push("darkweb_interaction"); }
  if (data.mixerInteraction) { score = Math.max(score, 75); flags.push("mixer_interaction"); }
  if (data.phishingFlag)     { score = Math.max(score, 80); flags.push("phishing_association"); }
  if (data.rugPullFlag)      { score = Math.max(score, 85); flags.push("rug_pull_history"); }
  if (data.newAddress)       { flags.push("new_address_limited_history"); }

  return { score: Math.min(100, score), flags };
}

// ── AGENT SCORE (0-100) ───────────────────────────────────────────────────────

function computeAgentScore(data: {
  isErc8004:         boolean;
  hasTBA:            boolean;
  erc8257Calls:      number;
  agentTxCount:      number;
  certifications:    string[];
  socialLinked:      boolean;
}): { score: number; highlights: string[] } {

  let score = 0;
  const highlights: string[] = [];

  if (data.isErc8004) {
    score += 30;
    highlights.push("Registered ERC-8004 agent — verified on-chain identity");
  }
  if (data.hasTBA) {
    score += 20;
    highlights.push("ERC-6551 Token Bound Account — autonomous wallet capability");
  }

  // ERC-8257 tool usage
  const toolScore = Math.min(20, data.erc8257Calls * 4);
  score += toolScore;
  if (data.erc8257Calls > 0) {
    highlights.push(`${data.erc8257Calls} ERC-8257 tool interactions — active agent behaviour`);
  }

  // Agent-to-agent transactions
  const agentTxScore = Math.min(15, data.agentTxCount * 3);
  score += agentTxScore;
  if (data.agentTxCount > 0) {
    highlights.push(`${data.agentTxCount} agent-to-agent transactions recorded`);
  }

  // Safety certifications
  const certScore = data.certifications.length * 5;
  score += Math.min(15, certScore);
  if (data.certifications.length > 0) {
    highlights.push(`Safety certified: ${data.certifications.join(", ")}`);
  }

  if (data.socialLinked) {
    highlights.push("Social presence linked and verified");
  }

  return { score: Math.min(100, score), highlights };
}

// ── COMPOSITE → LETTER ────────────────────────────────────────────────────────

function compositeScore(trust: number, risk: number, agent: number): number {
  // Trust: 50% weight, Risk inverted: 30% weight, Agent: 20% weight
  const riskInverted = 100 - risk;
  return Math.round(trust * 0.5 + riskInverted * 0.3 + agent * 0.2);
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

  // Parse wallet from query or body
  const wallet: string = (
    req.query?.wallet ||
    req.body?.wallet ||
    ""
  ).toString().toLowerCase().trim();

  const network: string = (
    req.query?.network ||
    req.body?.network ||
    "eth"
  ).toString().toLowerCase();

  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
    return res.status(400).json({
      error: "Invalid wallet address. Provide a valid 0x Ethereum address.",
    });
  }

  try {
    const cacheKey = `agentcheck:check:${wallet}:${network}`;

    // ── FETCH ALL DATA IN PARALLEL ──────────────────────────────────────────

    const [
      ethTxRes,
      ethBalRes,
      getblockRes,
      normiesAgentRes,
      endorsementsRes,
      outcomesRes,
      certRes,
      scopeRes,
      prevScoreRes,
    ] = await Promise.allSettled([

      // 1. Etherscan — transaction list
      fetch(
        `https://api.etherscan.io/api?module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=100&sort=asc&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 2. Etherscan — ETH balance
      fetch(
        `https://api.etherscan.io/api?module=account&action=balance&address=${wallet}&tag=latest&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 3. GetBlock — Fraud Check (risk + forensics)
      fetch(
        `https://hub-api.getblock.io/wallet-risk/fraudCheck`,
        {
          method: "POST",
          headers: {
            "x-api-key": GETBLOCK_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ address: wallet, network }),
        }
      ).then(r => r.json()).catch(() => null),
      
      // 4. Normies API — is this an ERC-8004 agent?
      fetch(`${NORMIES_API}/agents/info/${wallet}`).then(r => r.json()).catch(() => null),

      // 5. Redis — community endorsements
      redis.get(`agentcheck:endorsements:${wallet}`).catch(() => null),

      // 6. Redis — outcome history
      redis.get(`agentcheck:outcomes:${wallet}`).catch(() => null),

      // 7. Redis — safety certifications
      redis.get(`agentcheck:certs:${wallet}`).catch(() => null),

      // 8. Redis — declared permission scope
      redis.get(`agentcheck:scope:${wallet}`).catch(() => null),

      // 9. Redis — previous trust score (for outlook)
      redis.get(`agentcheck:prev_trust:${wallet}`).catch(() => null),
    ]);

    // ── PARSE ETHERSCAN ─────────────────────────────────────────────────────

    const txData   = ethTxRes.status   === "fulfilled" ? ethTxRes.value   : null;
    const balData  = ethBalRes.status  === "fulfilled" ? ethBalRes.value  : null;
    const gbData   = getblockRes.status === "fulfilled" ? getblockRes.value : null;
    const nmData   = normiesAgentRes.status === "fulfilled" ? normiesAgentRes.value : null;

    const endorsements: any = endorsementsRes.status === "fulfilled" ? endorsementsRes.value : null;
    const outcomes: any     = outcomesRes.status     === "fulfilled" ? outcomesRes.value     : null;
    const certs: any        = certRes.status         === "fulfilled" ? certRes.value         : null;
    const scope: any        = scopeRes.status        === "fulfilled" ? scopeRes.value        : null;
    const prevTrust: any    = prevScoreRes.status    === "fulfilled" ? prevScoreRes.value    : null;

    const txList = txData?.result && Array.isArray(txData.result) ? txData.result : [];
    const ethBalance = balData?.result
    const rawBalance = balData?.result && !isNaN(parseInt(balData.result))
      ? parseInt(balData.result)
      : 0;
    const ethBalance = (rawBalance / 1e18).toFixed(4);

    // Wallet age
    const firstTx    = txList[0];
    const firstTsRaw = firstTx ? parseInt(firstTx.timeStamp) * 1000 : null;
    const ageDays    = firstTsRaw
      ? Math.floor((Date.now() - firstTsRaw) / 86400000)
      : 0;
    const firstSeen  = firstTsRaw
      ? new Date(firstTsRaw).toISOString().split("T")[0]
      : null;

    // Transaction stats
    const totalTx      = txList.length;
    const successTx    = txList.filter((t: any) => t.isError === "0").length;
    const successRate  = totalTx > 0 ? successTx / totalTx : 0;
    const lastTx       = txList[txList.length - 1];
    const lastActive   = lastTx
      ? new Date(parseInt(lastTx.timeStamp) * 1000).toISOString().split("T")[0]
      : null;

    // Unique contracts interacted with (proxy for DeFi diversity)
    const uniqueContracts = new Set(
      txList.filter((t: any) => t.to && t.input !== "0x").map((t: any) => t.to)
    ).size;

    // ── PARSE GETBLOCK ──────────────────────────────────────────────────────

    const gbRisk        = gbData?.risk_score          ?? null;
    const gbLevel       = gbData?.risk_level          ?? null;
    const gbFlags       = gbData?.flags               ?? [];
    const gbSanctioned  = gbData?.sanctions?.sanctioned ?? false;
    const gbMixer       = gbFlags.includes("mixer_interaction");
    const gbDarkweb     = gbFlags.includes("darkweb_transaction");
    const gbPhishing    = gbFlags.includes("phishing");
    const gbRugPull     = gbFlags.includes("rug_pull");
    const gbNewAddress  = gbData?.is_new_address       ?? (ageDays < 30);

    // ── PARSE NORMIES / ERC-8004 ────────────────────────────────────────────

    const isErc8004  = !!(nmData && nmData.tokenId && !nmData.error);
    const agentName  = nmData?.name   || null;
    const agentType  = nmData?.type   || null;
    const agentLevel = nmData?.canvas?.level || null;

    // ── PARSE REDIS DATA ────────────────────────────────────────────────────

    const endorseCount    = endorsements ? (endorsements as any).count || 0    : 0;
    const endorseList     = endorsements ? (endorsements as any).list  || []   : [];
    const outcomesPos     = outcomes     ? (outcomes as any).positive  || 0    : 0;
    const outcomesTotal   = outcomes     ? (outcomes as any).total     || 0    : 0;
    const certList        = certs        ? (certs as string[])                 : [];
    const scopeData       = scope        ? (scope as any)                      : null;
    const prevTrustScore  = prevTrust    ? parseInt(prevTrust as string)       : null;

    // ── COMPUTE SCORES ──────────────────────────────────────────────────────

    const { score: trustScore, breakdown: trustBreakdown } = computeTrustScore({
      ageDays,
      totalTx,
      successRate,
      defiProtocols:    Math.min(uniqueContracts, 20),
      paymentHistory:   0, // x402 data — Phase 2
      erc8257Usage:     0, // ERC-8257 data — Phase 2
      endorsements:     endorseCount,
      outcomesPositive: outcomesPos,
      outcomesTotal,
    });

    const { score: riskScore, flags: riskFlags } = computeRiskScore({
      getblockRisk:     gbRisk,
      sanctioned:       gbSanctioned,
      mixerInteraction: gbMixer,
      darkwebFlag:      gbDarkweb,
      phishingFlag:     gbPhishing,
      rugPullFlag:      gbRugPull,
      newAddress:       gbNewAddress,
    });

    const { score: agentScore, highlights: agentHighlights } = computeAgentScore({
      isErc8004,
      hasTBA:           false, // ERC-6551 check — Phase 2
      erc8257Calls:     0,     // ERC-8257 call data — Phase 2
      agentTxCount:     0,     // agent-to-agent tx — Phase 2
      certifications:   certList,
      socialLinked:     false, // social layer — Phase 2
    });

    const composite = compositeScore(trustScore, riskScore, agentScore);
    const rating    = compositeToLetter(composite);
    const verdict   = letterToVerdict(rating, isErc8004);
    const scoreOutlook = outlook(trustScore, prevTrustScore);

    // ── BUILD HIGHLIGHTS ────────────────────────────────────────────────────

    const highlights: string[] = [];
    if (ageDays > 0)      highlights.push(`Wallet active ${ageDays} days${firstSeen ? ` since ${firstSeen}` : ""}`);
    if (totalTx > 0)      highlights.push(`${totalTx} transactions · ${Math.round(successRate * 100)}% success rate`);
    if (ethBalance)       highlights.push(`Current balance: ${ethBalance} ETH`);
    if (uniqueContracts)  highlights.push(`${uniqueContracts} unique contracts interacted with`);
    if (isErc8004)        highlights.push(`ERC-8004 registered agent${agentName ? ` — ${agentName}` : ""}${agentType ? ` (${agentType})` : ""}`);
    if (endorseCount > 0) highlights.push(`${endorseCount} community endorsements received`);
    if (outcomesTotal > 0) highlights.push(`${outcomesPos}/${outcomesTotal} verified transactions resolved positively`);
    highlights.push(...agentHighlights);

    // ── STORE THIS CHECK IN REDIS ────────────────────────────────────────────

    const checkRecord = {
      wallet,
      network,
      trust_score:  trustScore,
      risk_score:   riskScore,
      agent_score:  agentScore,
      composite,
      rating,
      ts:           Date.now(),
    };

    // Store check (non-blocking)
    Promise.all([
      redis.lpush(`agentcheck:history:${wallet}`, JSON.stringify(checkRecord)),
      redis.ltrim(`agentcheck:history:${wallet}`, 0, 99),
      redis.set(`agentcheck:prev_trust:${wallet}`, trustScore.toString()),
      redis.incr("agentcheck:total_checks"),
    ]).catch(() => {});

    // ── BUILD RESPONSE ──────────────────────────────────────────────────────

    const response = {
      // Summary
      wallet,
      network,
      rating,
      outlook:     scoreOutlook,
      verdict,
      checked_at:  new Date().toISOString(),

      // Three scores
      trust_score: trustScore,
      risk_score:  riskScore,
      agent_score: agentScore,
      composite,

      // Full report
      report: {
        highlights,
        risk_flags: riskScore > 50 ? riskFlags : [],
        trust_breakdown: trustBreakdown,

        wallet_data: {
          age_days:          ageDays,
          first_seen:        firstSeen,
          last_active:       lastActive,
          total_transactions: totalTx,
          success_rate:      `${Math.round(successRate * 100)}%`,
          eth_balance:       `${ethBalance} ETH`,
          unique_contracts:  uniqueContracts,
        },

        forensics: {
          provider:     "GetBlock Address Audit",
          risk_level:   gbLevel || (riskScore < 30 ? "LOW" : riskScore < 60 ? "MEDIUM" : "HIGH"),
          flags:        riskFlags,
          sanctioned:   gbSanctioned,
        },

        agent_identity: isErc8004 ? {
          registered:   true,
          standard:     "ERC-8004",
          name:         agentName,
          type:         agentType,
          level:        agentLevel,
        } : {
          registered:   false,
          standard:     null,
          note:         "Not a registered ERC-8004 agent",
        },

        certifications: {
          passed:       certList,
          pending:      ["prompt_injection", "secret_protection", "unsafe_action_gating"]
            .filter(c => !certList.includes(c)),
          note:         certList.length === 0
            ? "No safety certifications. Submit via POST /api/certify."
            : `${certList.length}/3 safety certifications passed.`,
        },

        community: {
          endorsements:     endorseCount,
          endorsers:        endorseList.slice(0, 5),
          outcomes_tracked: outcomesTotal,
          positive_outcomes: outcomesPos,
        },

        permission_scope: scopeData || {
          declared: false,
          note:     "No permission scope declared. Submit via POST /api/scope.",
        },
      },

      // Meta
      methodology: "https://github.com/BTSHTKRZY/agentcheck#methodology",
      powered_by:  ["Etherscan", "GetBlock Address Audit", "Normies ERC-8004 Registry"],
    };

    return res.status(200).json(response);

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
