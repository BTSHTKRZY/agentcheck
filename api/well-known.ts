import type { VercelRequest, VercelResponse } from "@vercel/node";

const MANIFEST = {
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
  name: "agent-check",
  description: "Trust rating agency for the agent economy. Rates any Ethereum wallet AAA to D. Returns trust score (on-chain history), risk score (forensic screening + sanctions), and agent score (ERC-8004 identity + safety certifications). Includes threat detection for inbound interactions, batch checking, score monitoring, endorsements, outcome tracking, and permission scope. Safety certification suite tests prompt injection resistance, secret protection, and unsafe action gating. Open access. No auth required.",
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
      wallet: {
        type: "string",
        description: "Ethereum wallet address to check (0x...)",
      },
      network: {
        type: "string",
        description: "Network: eth, base, polygon, bsc (default: eth)",
      },
    },
    required: ["wallet"],
  },
  outputs: {
    type: "object",
    properties: {
      rating:      { type: "string", description: "Letter grade AAA to D" },
      trust_score: { type: "number", description: "Trust score 0-100" },
      risk_score:  { type: "number", description: "Risk score 0-100" },
      agent_score: { type: "number", description: "Agent score 0-100" },
      verdict:     { type: "string", description: "Plain language verdict" },
      report:      { type: "object", description: "Full rating report" },
    },
  },
  creatorAddress: "0x020d6409ebc4fa13e754e0fea275ac353efd4f03",
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json(MANIFEST);
}
