{
  "type": "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
  "name": "agent-check",
  "description": "Trust and safety layer for the agent economy. Rates any Ethereum wallet AAA to D using a credit-agency-style scorecard, with a Not Rated status for unproven wallets. Includes forensic screening, ERC-8004 identity, wallet relationship graph, and ERC-8257 tool-usage signal. Dynamic behavioral safety certification (battery v1.2) tests a live agent endpoint against prompt injection, secret leakage, unsafe actions, and indirect/tool-output injection using LLM-as-judge scoring. On-chain cert registry and access predicate V2 (0x4738Db02). Open access, free single check.",
  "endpoint": "https://agentcheck-bice.vercel.app/api/check",
  "verifiability": {
    "tier": "self-attested",
    "execution": "serverless",
    "dataRetention": "metadata-only",
    "sourceVisibility": "open-source",
    "sourceUrl": "https://github.com/BTSHTKRZY/agentcheck"
  },
  "inputs": {
    "type": "object",
    "properties": {
      "wallet": { "type": "string", "description": "Ethereum wallet address to check (0x...)" },
      "network": { "type": "string", "description": "Network: eth, base, polygon, bsc (default: eth)" }
    },
    "required": ["wallet"]
  },
  "outputs": {
    "type": "object",
    "properties": {
      "rating": { "type": "string", "description": "Letter grade AAA to D, or NR (Not Rated)" },
      "trust_score": { "type": "number", "description": "Trust score 0-100" },
      "risk_score": { "type": "number", "description": "Risk score 0-100" },
      "agent_score": { "type": "number", "description": "Agent score 0-100" },
      "verdict": { "type": "string", "description": "Plain language verdict" },
      "report": { "type": "object", "description": "Full rating report" }
    }
  },
  "category": "security",
  "tags": ["security", "ai", "trust", "reputation", "wallet-rating", "agent-safety", "certification", "erc-8004", "erc-8257"],
  "version": "1.2.0",
  "pricing": [],
  "chains": ["ethereum", "base"],
  "display": {
    "name": "AgentCheck",
    "tagline": "Trust and safety for the agent economy",
    "url": "https://agentcheck-bice.vercel.app",
    "methodology": "https://agentcheck-bice.vercel.app/api/methodology"
  },
  "creatorAddress": "0x020d6409ebc4fa13e754e0fea275ac353efd4f03"
}
