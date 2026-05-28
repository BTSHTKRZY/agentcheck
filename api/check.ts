import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ETHERSCAN_KEY  = process.env.ETHERSCAN_API_KEY  || "";
const GETBLOCK_KEY   = process.env.GETBLOCK_API_KEY   || "";
const OPENSEA_KEY    = process.env.OPENSEA_API_KEY    || "";
const NORMIES_API    = "https://api.normies.art";
const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const TOTAL_MINTED   = 10000;

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

function outlook(trust: number, prev: number | null): string {
  if (prev === null) return "stable";
  const delta = trust - prev;
  if (delta > 5)  return "positive";
  if (delta < -5) return "negative";
  return "stable";
}

// ── TRUST SCORE (0-100) ───────────────────────────────────────────────────────

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
}): { score: number; breakdown: Record<string, number> } {
  const ageScore =
    data.ageDays > 730 ? 15 :
    data.ageDays > 365 ? 12 :
    data.ageDays > 180 ? 9  :
    data.ageDays > 90  ? 6  :
    data.ageDays > 30  ? 3  : 0;

  const txScore = Math.min(15, Math.floor(Math.log10(Math.max(1, data.totalTx)) * 5));

  const successScore =
    data.successRate >= 0.98 ? 20 :
    data.successRate >= 0.95 ? 16 :
    data.successRate >= 0.90 ? 12 :
    data.successRate >= 0.80 ? 6  : 0;

  const defiScore    = Math.min(10, data.defiProtocols * 2);
  const paymentScore = Math.min(15, data.paymentHistory * 3);
  const toolScore    = Math.min(10, data.erc8257Usage * 2);
  const endorseScore = Math.min(10, data.endorsements * 3);
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
  getblockRisk:     number | null;
  sanctioned:       boolean;
  mixerInteraction: boolean;
  darkwebFlag:      boolean;
  phishingFlag:     boolean;
  rugPullFlag:      boolean;
  newAddress:       boolean;
}): { score: number; flags: string[] } {
  let score = data.getblockRisk ?? 20;
  const flags: string[] = [];

  if (data.sanctioned)       { score = 100; flags.push("sanctioned_entity"); }
  if (data.darkwebFlag)      { score = Math.max(score, 90); flags.push("darkweb_interaction"); }
  if (data.mixerInteraction) { score = Math.max(score, 75); flags.push("mixer_interaction"); }
  if (data.phishingFlag)     { score = Math.max(score, 80); flags.push("phishing_association"); }
  if (data.rugPullFlag)      { score = Math.max(score, 85); flags.push("rug_pull_history"); }
  if (data.newAddress)       { flags.push("new_address_limited_history"); }

  return { score: Math.min(100, score), flags };
}

// ── AGENT SCORE (0-100) — now includes ERC-8004 agent binding ─────────────────

function computeAgentScore(data: {
  isErc8004:        boolean;
  agentName:        string | null;
  agentType:        string | null;
  agentLevel:       number | null;
  hasAgentBinding:  boolean;        // ERC-8004 binding confirmed via OpenSea API
  agentCapabilities: string[];      // capabilities from ERC-8004 metadata
  hasTBA:           boolean;
  erc8257Calls:     number;
  agentTxCount:     number;
  certifications:   string[];
  socialLinked:     boolean;
}): { score: number; highlights: string[] } {
  let score = 0;
  const highlights: string[] = [];

  // ERC-8004 registration — base agent identity
  if (data.isErc8004) {
    score += 25;
    highlights.push(`ERC-8004 registered agent${data.agentName ? ` — ${data.agentName}` : ""}${data.agentType ? ` (${data.agentType})` : ""}`);
  }

  // ERC-8004 agent binding confirmed via OpenSea API — stronger signal
  if (data.hasAgentBinding) {
    score += 15;
    highlights.push("ERC-8004 agent binding confirmed via OpenSea API");
  }

  // Agent capabilities declared
  if (data.agentCapabilities.length > 0) {
    score += Math.min(10, data.agentCapabilities.length * 2);
    highlights.push(`Declared capabilities: ${data.agentCapabilities.slice(0, 3).join(", ")}${data.agentCapabilities.length > 3 ? ` +${data.agentCapabilities.length - 3} more` : ""}`);
  }

  // Canvas level (Normies specific — shows investment in the ecosystem)
  if (data.agentLevel && data.agentLevel > 1) {
    const levelBonus = Math.min(5, Math.floor(data.agentLevel / 10));
    score += levelBonus;
    if (levelBonus > 0) highlights.push(`Canvas level ${data.agentLevel} — ecosystem investment`);
  }

  // TBA wallet
  if (data.hasTBA) {
    score += 15;
    highlights.push("ERC-6551 Token Bound Account — autonomous wallet capability");
  }

  // ERC-8257 tool usage
  const toolScore = Math.min(15, data.erc8257Calls * 4);
  score += toolScore;
  if (data.erc8257Calls > 0) {
    highlights.push(`${data.erc8257Calls} ERC-8257 tool interactions — active agent behaviour`);
  }

  // Agent-to-agent transactions
  const agentTxScore = Math.min(10, data.agentTxCount * 3);
  score += agentTxScore;
  if (data.agentTxCount > 0) {
    highlights.push(`${data.agentTxCount} agent-to-agent transactions recorded`);
  }

  // Safety certifications — 5 points each, max 15
  const certScore = data.certifications.length * 5;
  score += Math.min(15, certScore);
  if (data.certifications.length > 0) {
    highlights.push(`Safety certified: ${data.certifications.join(", ").replace(/_/g, " ")}`);
  }

  if (data.socialLinked) {
    highlights.push("Social presence linked and verified");
  }

  return { score: Math.min(100, score), highlights };
}

// ── COMPOSITE SCORE ───────────────────────────────────────────────────────────

function compositeScore(trust: number, risk: number, agent: number): number {
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
      ethTxRes,
      ethBalRes,
      ethNFTRes,
      getblockRes,
      normiesAgentRes,
      openSeaAgentRes,
      endorsementsRes,
      outcomesRes,
      certRes,
      scopeRes,
      prevScoreRes,
    ] = await Promise.allSettled([

      // 1. Etherscan — recent transactions
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 2. Etherscan — ETH balance
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance&address=${wallet}&tag=latest&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 3. Etherscan — NFT token holdings (check for Normies)
      fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokennfttx&address=${wallet}&contractaddress=${NORMIES_CONTRACT}&page=1&offset=10&sort=desc&apikey=${ETHERSCAN_KEY}`
      ).then(r => r.json()),

      // 4. GetBlock — fraud check
      fetch(
        `https://hub-api.getblock.io/wallet-risk/fraudCheck`,
        {
          method: "POST",
          headers: { "x-api-key": GETBLOCK_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ address: wallet, network }),
        }
      ).then(r => r.json()).catch(() => null),

      // 5. Normies API — ERC-8004 agent identity by wallet
      fetch(`${NORMIES_API}/agents/info/${wallet}`).then(r => r.json()).catch(() => null),

      // 6. OpenSea API — check for agent-bound NFTs owned by this wallet
      // This checks ERC-8004 agent binding via OpenSea's agent metadata support
      fetch(
        `https://api.opensea.io/api/v2/chain/ethereum/account/${wallet}/nfts?limit=50`,
        { headers: { "x-api-key": OPENSEA_KEY, "accept": "application/json" } }
      ).then(r => r.json()).catch(() => null),

      // 7. Redis — endorsements
      redis.get(`agentcheck:endorsements:${wallet}`).catch(() => null),

      // 8. Redis — outcomes
      redis.get(`agentcheck:outcomes:${wallet}`).catch(() => null),

      // 9. Redis — certifications
      redis.get(`agentcheck:certs:${wallet}`).catch(() => null),

      // 10. Redis — permission scope
      redis.get(`agentcheck:scope:${wallet}`).catch(() => null),

      // 11. Redis — previous trust score
      redis.get(`agentcheck:prev_trust:${wallet}`).catch(() => null),
    ]);

    // ── PARSE ──────────────────────────────────────────────────────────────────

    const txData   = ethTxRes.status    === "fulfilled" ? ethTxRes.value    : null;
    const balData  = ethBalRes.status   === "fulfilled" ? ethBalRes.value   : null;
    const nftData  = ethNFTRes.status   === "fulfilled" ? ethNFTRes.value   : null;
    const gbData   = getblockRes.status === "fulfilled" ? getblockRes.value : null;
    const nmData   = normiesAgentRes.status === "fulfilled" ? normiesAgentRes.value : null;
    const osData   = openSeaAgentRes.status === "fulfilled" ? openSeaAgentRes.value : null;

    const endorsements = endorsementsRes.status === "fulfilled" ? endorsementsRes.value : null;
    const outcomes     = outcomesRes.status     === "fulfilled" ? outcomesRes.value     : null;
    const certs        = certRes.status         === "fulfilled" ? certRes.value         : null;
    const scope        = scopeRes.status        === "fulfilled" ? scopeRes.value        : null;
    const prevTrust    = prevScoreRes.status    === "fulfilled" ? prevScoreRes.value    : null;

    // ── ETHERSCAN DATA ─────────────────────────────────────────────────────────

    const txList = txData?.result && Array.isArray(txData.result) ? txData.result : [];

    const rawBalance = balData?.result && !isNaN(parseInt(balData.result))
      ? parseInt(balData.result) : 0;
    const ethBalance = (rawBalance / 1e18).toFixed(4);

    // Wallet age from oldest transaction in our window
    const oldestTx   = txList[txList.length - 1];
    const newestTx   = txList[0];
    const firstTsRaw = oldestTx ? parseInt(oldestTx.timeStamp) * 1000 : null;
    const ageDays    = firstTsRaw ? Math.floor((Date.now() - firstTsRaw) / 86400000) : 0;
    const firstSeen  = firstTsRaw ? new Date(firstTsRaw).toISOString().split("T")[0] : null;
    const lastActive = newestTx ? new Date(parseInt(newestTx.timeStamp) * 1000).toISOString().split("T")[0] : null;

    const totalTx     = txList.length;
    const successTx   = txList.filter((t: any) => t.isError === "0").length;
    const successRate = totalTx > 0 ? successTx / totalTx : 0;

    const uniqueContracts = new Set(
      txList.filter((t: any) => t.to && t.input !== "0x").map((t: any) => t.to)
    ).size;

    // ── OPENSEA ERC-8004 AGENT BINDING CHECK ───────────────────────────────────

    let hasAgentBinding   = false;
    let agentCapabilities: string[] = [];
    let agentNFTs: any[]  = [];

    if (osData?.nfts && Array.isArray(osData.nfts)) {
      // Check for NFTs with agent_binding or ERC-8004 metadata
      agentNFTs = osData.nfts.filter((nft: any) =>
        nft.agent_binding ||
        nft.metadata?.agent_metadata ||
        nft.traits?.some((t: any) =>
          t.trait_type?.toLowerCase().includes("agent") ||
          t.trait_type?.toLowerCase().includes("skill") ||
          t.trait_type?.toLowerCase().includes("capability")
        )
      );

      if (agentNFTs.length > 0) {
        hasAgentBinding = true;
        // Extract capabilities from traits
        agentNFTs.forEach((nft: any) => {
          const capTraits = (nft.traits || []).filter((t: any) =>
            ["capability", "skill", "service", "tool"].includes(
              (t.trait_type || "").toLowerCase()
            )
          );
          capTraits.forEach((t: any) => {
            if (t.value) agentCapabilities.push(t.value);
          });
        });
        agentCapabilities = [...new Set(agentCapabilities)].slice(0, 10);
      }
    }

    // ── GETBLOCK DATA ──────────────────────────────────────────────────────────

    const gbRisk       = gbData?.risk_score            ?? null;
    const gbLevel      = gbData?.risk_level            ?? null;
    const gbFlags      = gbData?.flags                 ?? [];
    const gbSanctioned = gbData?.sanctions?.sanctioned ?? false;
    const gbMixer      = gbFlags.includes("mixer_interaction");
    const gbDarkweb    = gbFlags.includes("darkweb_transaction");
    const gbPhishing   = gbFlags.includes("phishing");
    const gbRugPull    = gbFlags.includes("rug_pull");
    const gbNewAddress = gbData?.is_new_address        ?? (ageDays < 30);

    // ── NORMIES / ERC-8004 ────────────────────────────────────────────────────

    const isErc8004  = !!(nmData && nmData.tokenId && !nmData.error);
    const agentName  = nmData?.name         || null;
    const agentType  = nmData?.type         || null;
    const agentLevel = nmData?.canvas?.level || null;

    // Also check via Normies NFT holdings from Etherscan
    const normiesHeld = nftData?.result && Array.isArray(nftData.result) && nftData.result.length > 0;

    // ── REDIS DATA ─────────────────────────────────────────────────────────────

    const endorseCount   = endorsements ? (endorsements as any).count    || 0  : 0;
    const endorseList    = endorsements ? (endorsements as any).list     || [] : [];
    const outcomesPos    = outcomes     ? (outcomes as any).positive     || 0  : 0;
    const outcomesTotal  = outcomes     ? (outcomes as any).total        || 0  : 0;
    const certList       = certs        ? (certs as string[])                  : [];
    const scopeData      = scope        ? (scope as any)                       : null;
    const prevTrustScore = prevTrust    ? parseInt(prevTrust as string)        : null;

    // ── COMPUTE SCORES ─────────────────────────────────────────────────────────

    const { score: trustScore, breakdown: trustBreakdown } = computeTrustScore({
      ageDays,
      totalTx,
      successRate,
      defiProtocols:    Math.min(uniqueContracts, 20),
      paymentHistory:   0,
      erc8257Usage:     0,
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
      agentName,
      agentType,
      agentLevel,
      hasAgentBinding,
      agentCapabilities,
      hasTBA:           false,
      erc8257Calls:     0,
      agentTxCount:     0,
      certifications:   certList,
      socialLinked:     false,
    });

    const rawComposite = compositeScore(trustScore, riskScore, agentScore);

    // Floor: wallets with real history and no serious flags never go below BB
    const hasRealHistory = ageDays > 0 && totalTx > 0;
    const hasSeriousFlag = gbSanctioned || gbMixer || gbDarkweb || gbPhishing || gbRugPull;
    const adjustedComposite = (hasRealHistory && !hasSeriousFlag)
      ? Math.max(rawComposite, 50)
      : rawComposite;

    const rating       = compositeToLetter(adjustedComposite);
    const verdict      = letterToVerdict(rating, isErc8004 || hasAgentBinding);
    const scoreOutlook = outlook(trustScore, prevTrustScore);

    // ── BUILD HIGHLIGHTS ───────────────────────────────────────────────────────

    const highlights: string[] = [];
    if (ageDays > 0)                    highlights.push(`Wallet active ${ageDays} days${firstSeen ? ` since ${firstSeen}` : ""}`);
    if (totalTx > 0)                    highlights.push(`${totalTx} recent transactions · ${Math.round(successRate * 100)}% success rate`);
    if (parseFloat(ethBalance) > 0)     highlights.push(`Current balance: ${ethBalance} ETH`);
    if (uniqueContracts)                highlights.push(`${uniqueContracts} unique contracts interacted with`);
    if (normiesHeld)                    highlights.push("Normies NFT holder — ecosystem participant");
    if (endorseCount > 0)               highlights.push(`${endorseCount} community endorsements received`);
    if (outcomesTotal > 0)              highlights.push(`${outcomesPos}/${outcomesTotal} verified transactions resolved positively`);
    highlights.push(...agentHighlights);

    // ── STORE IN REDIS ─────────────────────────────────────────────────────────

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

    // ── RESPONSE ───────────────────────────────────────────────────────────────

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
        age_days:           totalTx === 100 && ageDays < 180 ? null : ageDays,
        first_seen:         totalTx === 100 && ageDays < 180 ? null : firstSeen,
        age_note:           totalTx === 100 && ageDays < 180
          ? "Wallet age hidden — showing 100 most recent transactions only. True age may be significantly older."
          : null,
        last_active:        lastActive,

          total_transactions: totalTx,
          success_rate:       `${Math.round(successRate * 100)}%`,
          eth_balance:        `${ethBalance} ETH`,
          unique_contracts:   uniqueContracts,
          normies_holder:     normiesHeld,
          note:               "Transaction data shows most recent 100 transactions via Etherscan.",
        },

        forensics: {
          provider:   "GetBlock Fraud Check",
          risk_level: gbLevel || (riskScore < 30 ? "LOW" : riskScore < 60 ? "MEDIUM" : "HIGH"),
          flags:      riskFlags,
          sanctioned: gbSanctioned,
        },

        // ERC-8004 + ERC-8217 agent identity — combined
        agent_identity: {
          is_agent:           isErc8004 || hasAgentBinding,
          erc8004_registered: isErc8004,
          agent_binding:      hasAgentBinding,
          name:               agentName,
          type:               agentType,
          level:              agentLevel,
          capabilities:       agentCapabilities,
          agent_nfts_held:    agentNFTs.length,
          note: !isErc8004 && !hasAgentBinding
            ? "Not a registered ERC-8004 agent"
            : hasAgentBinding && !isErc8004
            ? "Agent binding confirmed via OpenSea API (ERC-8004 metadata)"
            : "ERC-8004 registered agent with on-chain identity",
        },

        certifications: {
          passed:  certList,
          pending: ["prompt_injection", "secret_protection", "unsafe_action_gating"]
            .filter(c => !certList.includes(c)),
          note: certList.length === 0
            ? "No safety certifications. Submit via POST /api/certify."
            : `${certList.length}/3 safety certifications passed.`,
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

      // Quick links
      human_report: `https://agentcheck-bice.vercel.app/api/report?wallet=${wallet}`,
      methodology:  "https://github.com/BTSHTKRZY/agentcheck#methodology",
      powered_by:   ["Etherscan v2", "GetBlock Fraud Check", "Normies ERC-8004 Registry", "OpenSea Agent API"],
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
