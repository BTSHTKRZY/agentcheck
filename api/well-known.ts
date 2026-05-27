import type { VercelRequest, VercelResponse } from "@vercel/node";

const MANIFEST = {
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
  name: "agent-check",
  description:
    "The rating agency for the agent economy. AgentCheck provides comprehensive trust intelligence for any Ethereum wallet or AI agent. Returns a letter grade (AAA to D), three scores (trust, risk, agent), full rating report, safety certification status, declared permission scope, and regulatory audit trail. Data sourced from on-chain history, forensic risk screening, ERC-8004 agent registry, ERC-8257 tool usage, and community endorsements. Designed for agents that need to verify counterparties before transacting autonomously. Also provides owner monitoring, safety certification testing, agent endorsements, and outcome reporting endpoints.",
  endpoint: "https://agentcheck.vercel.app/api/check",
  verifiability: {
    tier: "self-attested",
    execution: "serverless",
    dataRetention: "anonymized-aggregates",
    sourceVisibility: "open-source",
    sourceUrl: "https://github.com/BTSHTKRZY/agentcheck",
  },
  inputs: {
    type: "object",
    properties: {
      wallet: {
        type: "string",
        description: "Ethereum wallet address to check (0x...)",
      },
      network: {
        type: "string",
        description: "Network to check: eth, base, polygon, bsc (default: eth)",
      },
    },
    required: ["wallet"],
  },
  outputs: {
    type: "object",
    properties: {
      rating: {
        type: "string",
        description: "Letter grade from AAA to D",
      },
      trust_score: {
        type: "number",
        description: "Trust score 0-100 based on historical behaviour",
      },
      risk_score: {
        type: "number",
        description: "Risk score 0-100 based on forensic screening",
      },
      agent_score: {
        type: "number",
        description: "Agent score 0-100 based on on-chain agent activity",
      },
      verdict: {
        type: "string",
        description: "Plain language verdict for the calling agent",
      },
      report: {
        type: "object",
        description: "Full rating report with all signals and highlights",
      },
    },
  },
  creatorAddress: "0x020d6409ebc4fa13e754e0fea275ac353efd4f03",
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json(MANIFEST);
}
