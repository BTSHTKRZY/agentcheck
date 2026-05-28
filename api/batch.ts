import type { VercelRequest, VercelResponse } from "@vercel/node";

const BASE_URL = "https://agentcheck-bice.vercel.app";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { wallets, network = "eth" } = req.body;

  if (!Array.isArray(wallets) || wallets.length === 0) {
    return res.status(400).json({ error: "Provide wallets array: { wallets: ['0x...', '0x...'] }" });
  }

  // Cap at 10 wallets per batch (free tier)
  const MAX_BATCH = 10;
  if (wallets.length > MAX_BATCH) {
    return res.status(400).json({
      error: `Batch limited to ${MAX_BATCH} wallets. Split into multiple requests.`,
      limit: MAX_BATCH,
    });
  }

  // Validate all addresses
  const invalid = wallets.filter(
    (w: string) => !w || !w.startsWith("0x") || w.length !== 42
  );
  if (invalid.length > 0) {
    return res.status(400).json({
      error: `Invalid wallet addresses: ${invalid.join(", ")}`,
    });
  }

  const startTs = Date.now();

  try {
    // Check all wallets in parallel
    const results = await Promise.allSettled(
      wallets.map((wallet: string) =>
        fetch(`${BASE_URL}/api/check?wallet=${wallet.toLowerCase()}&network=${network}`)
          .then(r => r.json())
          .catch(err => ({ error: err.message, wallet }))
      )
    );

    const summaries = results.map((result, i) => {
      const wallet = wallets[i].toLowerCase();

      if (result.status === "rejected" || result.value?.error) {
        return {
          wallet,
          error: result.status === "rejected"
            ? result.reason?.message
            : result.value?.error,
        };
      }

      const d = result.value;
      return {
        wallet,
        rating:      d.rating,
        outlook:     d.outlook,
        verdict:     d.verdict,
        trust_score: d.trust_score,
        risk_score:  d.risk_score,
        agent_score: d.agent_score,
        composite:   d.composite,
        safe_to_transact: ["AAA","AA","A","BBB","BB"].includes(d.rating),
        is_agent:    d.report?.agent_identity?.registered || false,
        sanctioned:  d.report?.forensics?.sanctioned || false,
        flags:       d.report?.risk_flags || [],
        report_url:  `https://agentcheck-bice.vercel.app/api/report?wallet=${wallet}`,
      };
    });

    // Sort by composite score descending
    const sorted = summaries
      .filter(s => !s.error)
      .sort((a: any, b: any) => (b.composite || 0) - (a.composite || 0));

    const errors = summaries.filter(s => s.error);

    // Summary stats
    const safeCount    = sorted.filter((s: any) => s.safe_to_transact).length;
    const agentCount   = sorted.filter((s: any) => s.is_agent).length;
    const flaggedCount = sorted.filter((s: any) => s.flags?.length > 0 || s.sanctioned).length;

    return res.status(200).json({
      checked_at:     new Date().toISOString(),
      duration_ms:    Date.now() - startTs,
      total:          wallets.length,
      successful:     sorted.length,
      errors:         errors.length,

      summary: {
        safe_to_transact:  safeCount,
        risky_or_unknown:  sorted.length - safeCount,
        registered_agents: agentCount,
        flagged_wallets:   flaggedCount,
        highest_rated:     sorted[0]?.wallet || null,
        lowest_rated:      sorted[sorted.length - 1]?.wallet || null,
      },

      results: sorted,
      errors:  errors.length > 0 ? errors : undefined,

      note: `Batch limited to ${MAX_BATCH} wallets. All tiers free.`,
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
