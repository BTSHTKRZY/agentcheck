// lib/knownAddresses.ts — labels for well-known contracts and wallets.
// Used by check.ts (to label the checked address) and to filter the
// relationship graph (protocol contracts are not EOA counterparties).

export interface KnownAddress {
  label:    string;
  type:     "token" | "protocol" | "infrastructure" | "agent" | "notable";
  verified: boolean;
}

// All keys MUST be lowercase.
export const KNOWN_ADDRESSES: Record<string, KnownAddress> = {
  // Stablecoins / tokens
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { label: "USDC", type: "token", verified: true },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { label: "USDT (Tether)", type: "token", verified: true },
  "0x6b175474e89094c44da98b954eedeac495271d0f": { label: "DAI", type: "token", verified: true },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { label: "WETH", type: "token", verified: true },
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": { label: "WBTC", type: "token", verified: true },

  // DEX / routers
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": { label: "Uniswap V2 Router", type: "protocol", verified: true },
  "0xe592427a0aece92de3edee1f18e0157c05861564": { label: "Uniswap V3 Router", type: "protocol", verified: true },
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": { label: "Uniswap Universal Router", type: "protocol", verified: true },
  "0x1111111254eeb25477b68fb85ed929f73a960582": { label: "1inch Router", type: "protocol", verified: true },

  // NFT / OpenSea
  "0x00005ea00ac477b1030ce78506496e8c2de24bf5": { label: "Seaport (OpenSea)", type: "protocol", verified: true },
  "0x00000000006c3852cbef3e08e8df289169ede581": { label: "Seaport 1.1 (OpenSea)", type: "protocol", verified: true },

  // ERC-6551
  "0x000000006551c19487814612e58fe06813775758": { label: "ERC-6551 Registry", type: "infrastructure", verified: true },

  // The agent economy — our own stack
  "0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1": { label: "ERC-8257 Agent Tool Registry", type: "infrastructure", verified: true },
  "0x803a8988e40cbb54897e5782a6a589d907a5b03a": { label: "AgentCheck Certification Registry", type: "infrastructure", verified: true },
  "0x4738db02a82fb745460e86d568d387ef95b3eb18": { label: "AgentCheck Cert Predicate V2", type: "infrastructure", verified: true },
  "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432": { label: "ERC-8004 Trustless Agents Registry", type: "infrastructure", verified: true },

  // Notable
  "0xd8da6bf26964af9d7eed9e03e53415d37aa96045": { label: "vitalik.eth", type: "notable", verified: true },
};

// Common protocol/contract counterparties to exclude from EOA trust graph
// even if not individually labelled above. These are reached via contract
// calls, not peer-to-peer transfers.
export function isKnownContract(addr: string): boolean {
  return !!KNOWN_ADDRESSES[addr.toLowerCase()];
}

export function getLabel(addr: string): KnownAddress | null {
  return KNOWN_ADDRESSES[addr.toLowerCase()] || null;
}
