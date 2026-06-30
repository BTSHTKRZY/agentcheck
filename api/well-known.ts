import type { VercelRequest, VercelResponse } from "@vercel/node";

// Serves the ERC-8257 tool manifest at /.well-known/ai-tool/agent-check.json
// (routed here via vercel.json). This is a FUNCTION that returns the manifest
// JSON — the file must export a default handler, not just contain JSON.

const MANIFEST = {
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
  name: "agent-check",
  description: "Trust and safety layer for the agent economy. Rates any wallet AAA to D with a credit-agency scorecard (plus Not Rated for unproven wallets). Forensic screening, ERC-8004 identity, wallet graph, ERC-8257 usage signal. Dynamic behavioral cert (battery v1.2) tests a live agent against prompt injection, secret leakage, unsafe actions, and indirect/tool-output injection via LLM-as-judge. On-chain cert registry + predicate V2. Free single check.",
  endpoint: "https://agentcheck-bice.vercel.app/api/check",
  verifiability: {
    tier: "self-attested",
    execution: "serverless",
    dataRetention: "metadata-only",
    sourceVisibility: "open-source",
    sourceUrl: "https://github.com/BTSHTKRZY/agentcheck",
  },
  inputs: {
    type: "object",
    properties: {
      wallet: { type: "string", description: "Ethereum wallet address to check (0x...)" },
      network: { type: "string", description: "Network: eth, base, polygon, bsc (default: eth)" },
    },
    required: ["wallet"],
  },
  outputs: {
    type: "object",
    properties: {
      rating: { type: "string", description: "Letter grade AAA to D, or NR (Not Rated)" },
      trust_score: { type: "number", description: "Trust score 0-100" },
      risk_score: { type: "number", description: "Risk score 0-100" },
      agent_score: { type: "number", description: "Agent score 0-100" },
      verdict: { type: "string", description: "Plain language verdict" },
      report: { type: "object", description: "Full rating report" },
    },
  },
  category: "security",
  tags: ["security", "ai", "trust", "reputation", "wallet-rating", "agent-safety", "certification", "erc-8004", "erc-8257"],
  version: "1.2.0",
  pricing: [],
  chains: ["ethereum", "base"],
  display: {
    name: "AgentCheck",
    tagline: "Trust and safety for the agent economy",
    url: "https://agentcheck-bice.vercel.app",
    methodology: "https://agentcheck-bice.vercel.app/api/methodology",
  },
  creatorAddress: "0x020d6409ebc4fa13e754e0fea275ac353efd4f03",
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json(MANIFEST);
}
