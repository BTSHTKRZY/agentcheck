import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/html");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>AgentCheck — How Scores Work</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#07070D;color:#e2e8f0;font-family:'Inter',sans-serif;min-height:100vh;line-height:1.7;}
    .container{max-width:720px;margin:0 auto;padding:48px 24px 80px;}
    h1{font-size:28px;font-weight:600;color:#e2e8f0;margin-bottom:6px;}
    h2{font-size:16px;font-weight:600;color:#e2e8f0;margin:32px 0 12px;font-family:'Space Mono',monospace;letter-spacing:0.04em;}
    h3{font-size:13px;font-weight:600;color:#94a3b8;margin:20px 0 8px;font-family:'Space Mono',monospace;letter-spacing:0.06em;text-transform:uppercase;}
    p{font-size:15px;color:#94a3b8;margin-bottom:12px;}
    .card{background:#0f0f1a;border:1px solid #1e1e3a;border-radius:10px;padding:20px 24px;margin-bottom:12px;}
    .grade-row{display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid #1e1e3a;}
    .grade-row:last-child{border-bottom:none;}
    .grade{font-size:20px;font-weight:700;font-family:'Space Mono',monospace;min-width:52px;}
    .grade-desc{font-size:14px;color:#94a3b8;}
    .grade-note{font-size:12px;margin-top:3px;}
    .signal-row{display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid #1e1e3a;}
    .signal-row:last-child{border-bottom:none;}
    .signal-name{font-size:14px;color:#e2e8f0;}
    .signal-pts{font-size:13px;font-family:'Space Mono',monospace;color:#6366f1;}
    .new-badge{font-size:10px;background:#6366f120;color:#6366f1;border:1px solid #6366f140;padding:1px 6px;border-radius:4px;margin-left:8px;font-family:'Space Mono',monospace;}
    .tip{background:#0a0a1a;border:1px solid #6366f130;border-radius:8px;padding:16px 20px;margin:16px 0;}
    .tip-title{font-size:12px;font-family:'Space Mono',monospace;letter-spacing:0.1em;color:#6366f1;margin-bottom:8px;}
    a{color:#6366f1;text-decoration:none;}
    code{font-family:'Space Mono',monospace;font-size:12px;background:#0a0a1a;padding:12px 16px;border-radius:8px;display:block;color:#94a3b8;overflow-x:auto;margin:8px 0 16px;}
    .divider{height:1px;background:#1e1e3a;margin:32px 0;}
  </style>
</head>
<body>
<div class="container">

  <div style="margin-bottom:40px;">
    <div style="font-size:10px;letter-spacing:0.24em;color:#6366f1;font-family:'Space Mono',monospace;margin-bottom:8px;">AGENTCHECK · ERC-8257 TOOL #13 · BASE</div>
    <h1>How Scores Work</h1>
    <p style="margin-top:8px;font-size:16px;">A plain-language explanation of how AgentCheck rates any Ethereum wallet or AI agent.</p>
  </div>

  <h2>The Rating Scale</h2>
  <p>Every wallet gets a letter grade based on a composite score from 0 to 100. The scale is intentionally conservative.</p>

  <div class="card">
    <div class="grade-row"><div class="grade" style="color:#22c55e;">AAA</div><div><div class="grade-desc">Exceptional. Highest trust. Safe to transact.</div><div class="grade-note" style="color:#22c55e50;">Composite 90+</div></div></div>
    <div class="grade-row"><div class="grade" style="color:#22c55e;">AA</div><div><div class="grade-desc">Strong. Established track record.</div><div class="grade-note" style="color:#22c55e50;">Composite 80–89</div></div></div>
    <div class="grade-row"><div class="grade" style="color:#22c55e;">A</div><div><div class="grade-desc">Good. Solid history. Generally safe.</div><div class="grade-note" style="color:#22c55e50;">Composite 70–79</div></div></div>
    <div class="grade-row"><div class="grade" style="color:#eab308;">BBB</div><div><div class="grade-desc">Adequate. Limited history, no adverse flags.</div><div class="grade-note" style="color:#eab308;font-size:12px;margin-top:4px;">⭐ Most legitimate wallets start here. This is a good score.</div><div class="grade-note" style="color:#eab30870;">Composite 60–69</div></div></div>
    <div class="grade-row"><div class="grade" style="color:#eab308;">BB</div><div><div class="grade-desc">Newer wallet or limited visible history. No flags.</div><div class="grade-note" style="color:#eab308;font-size:12px;margin-top:4px;">⭐ Also a solid score — clean wallet, limited history visible.</div><div class="grade-note" style="color:#eab30870;">Composite 50–59 · Floor for wallets with real history and no flags</div></div></div>
    <div class="grade-row"><div class="grade" style="color:#f97316;">B</div><div><div class="grade-desc">Limited data or minor concerns.</div><div class="grade-note" style="color:#f9731650;">Composite 40–49</div></div></div>
    <div class="grade-row"><div class="grade" style="color:#f97316;">CCC</div><div><div class="grade-desc">Active risk flags. Avoid high-value transactions.</div><div class="grade-note" style="color:#f9731650;">Composite 30–39</div></div></div>
    <div class="grade-row"><div class="grade" style="color:#ef4444;">CC</div><div><div class="grade-desc">Multiple serious flags. Do not transact.</div><div class="grade-note" style="color:#ef444450;">Composite 20–29</div></div></div>
    <div class="grade-row"><div class="grade" style="color:#ef4444;">C</div><div><div class="grade-desc">High risk. Known adverse activity.</div><div class="grade-note" style="color:#ef444450;">Composite 10–19</div></div></div>
    <div class="grade-row"><div class="grade" style="color:#ef4444;">D</div><div><div class="grade-desc">Confirmed malicious or sanctioned. Do not transact.</div><div class="grade-note" style="color:#ef444450;">Composite 0–9</div></div></div>
  </div>

  <div class="divider"></div>

  <h2>The Three Scores</h2>
  <p>The composite score is weighted from three separate scores.</p>

  <h3>Trust Score — 50% of composite</h3>
  <div class="card">
    <div class="signal-row"><span class="signal-name">Wallet age</span><span class="signal-pts">up to 15 pts</span></div>
    <div class="signal-row"><span class="signal-name">Transaction volume</span><span class="signal-pts">up to 15 pts</span></div>
    <div class="signal-row"><span class="signal-name">Transaction success rate</span><span class="signal-pts">up to 20 pts</span></div>
    <div class="signal-row"><span class="signal-name">Protocol diversity</span><span class="signal-pts">up to 10 pts</span></div>
    <div class="signal-row"><span class="signal-name">Community endorsements</span><span class="signal-pts">up to 10 pts</span></div>
    <div class="signal-row"><span class="signal-name">Verified transaction outcomes</span><span class="signal-pts">up to 5 pts</span></div>
    <div class="signal-row">
      <span class="signal-name">ERC-8257 tool usage on Base <span class="new-badge">NEW</span></span>
      <span class="signal-pts">up to 10 pts</span>
    </div>
    <div class="signal-row">
      <span class="signal-name">Wallet relationship graph <span class="new-badge">NEW</span></span>
      <span class="signal-pts">up to 10 pts</span>
    </div>
    <div class="signal-row"><span class="signal-name" style="color:#4a5568;">x402 payment history · coming soon</span><span class="signal-pts" style="color:#4a5568;">up to 10 pts</span></div>
  </div>

  <div class="tip">
    <div class="tip-title">ERC-8257 TOOL USAGE</div>
    <p style="margin:0;font-size:14px;">Wallets that actively call tools registered on the ERC-8257 Agent Tool Registry on Base demonstrate verifiable agent behaviour. Each interaction adds to the trust score. AgentCheck is Tool #13 on this registry.</p>
  </div>

  <div class="tip">
    <div class="tip-title">WALLET RELATIONSHIP GRAPH</div>
    <p style="margin:0;font-size:14px;">AgentCheck analyses the trust scores of a wallet's recent counterparties. A wallet that consistently transacts with highly-rated wallets scores higher. A wallet surrounded by risky counterparties scores lower — trust by association and risk by association both apply.</p>
  </div>

  <h3>Risk Score — 30% of composite (lower is safer)</h3>
  <div class="card">
    <div class="signal-row"><span class="signal-name">GetBlock forensic risk score</span><span class="signal-pts">baseline</span></div>
    <div class="signal-row"><span class="signal-name">Sanctions (OFAC / EU / UN)</span><span class="signal-pts">instant D if flagged</span></div>
    <div class="signal-row"><span class="signal-name">Darkweb transaction history</span><span class="signal-pts">score → 90+</span></div>
    <div class="signal-row"><span class="signal-name">Phishing association</span><span class="signal-pts">score → 80+</span></div>
    <div class="signal-row"><span class="signal-name">Rug pull history</span><span class="signal-pts">score → 85+</span></div>
    <div class="signal-row"><span class="signal-name">Mixer / tumbler interaction</span><span class="signal-pts">score → 75+</span></div>
    <div class="signal-row"><span class="signal-name">Community flagged</span><span class="signal-pts">score → 70+</span></div>
    <div class="signal-row"><span class="signal-name">High-risk counterparty network</span><span class="signal-pts">score → 50+</span></div>
  </div>

  <h3>Agent Score — 20% of composite</h3>
  <div class="card">
    <div class="signal-row"><span class="signal-name">ERC-8004 registration</span><span class="signal-pts">25 pts</span></div>
    <div class="signal-row"><span class="signal-name">Agent binding confirmed (OpenSea)</span><span class="signal-pts">15 pts</span></div>
    <div class="signal-row"><span class="signal-name">ERC-6551 Token Bound Account</span><span class="signal-pts">15 pts</span></div>
    <div class="signal-row"><span class="signal-name">Declared capabilities</span><span class="signal-pts">up to 10 pts</span></div>
    <div class="signal-row"><span class="signal-name">ERC-8257 registry interactions</span><span class="signal-pts">up to 15 pts</span></div>
    <div class="signal-row"><span class="signal-name">Safety certifications (3 available)</span><span class="signal-pts">5 pts each</span></div>
  </div>

  <div class="divider"></div>

  <h2>The Formula</h2>
  <div class="card" style="font-family:'Space Mono',monospace;font-size:13px;color:#94a3b8;line-height:2;">
    <div>composite = (trust × 0.5) + ((100 − risk) × 0.3) + (agent × 0.2)</div>
    <div style="margin-top:8px;color:#4a5568;font-size:11px;">Floor: wallets with real history and no serious flags → minimum BB (composite 50)</div>
    <div style="color:#4a5568;font-size:11px;">Override: sanctioned wallets → instant D regardless of other signals</div>
  </div>

  <div class="divider"></div>

  <h2>Safety Certifications</h2>
  <p>AgentCheck tests agents against 15 adversarial scenarios across three batteries. The certification is recorded on-chain — verifiable from the EVM without trusting AgentCheck's API.</p>
  <div class="card">
    <div class="signal-row"><span class="signal-name">Prompt injection resistance (5 tests)</span><span class="signal-pts">5 pts</span></div>
    <div class="signal-row"><span class="signal-name">Secret protection (5 tests)</span><span class="signal-pts">5 pts</span></div>
    <div class="signal-row"><span class="signal-name">Unsafe action gating (5 tests)</span><span class="signal-pts">5 pts</span></div>
  </div>
  <div class="tip">
    <div class="tip-title">ON-CHAIN VERIFICATION</div>
    <p style="margin:0;font-size:14px;">Certifications are stored on Base at <code style="display:inline;padding:2px 6px;font-size:11px;">0x803A8988E40CBb54897e5782A6A589d907A5B03A</code>. Call <code style="display:inline;padding:2px 6px;font-size:11px;">isCertified(address)</code> directly from any contract — no API call needed. Certs expire in 90 days and include a battery hash so you can verify exactly which prompts were used.</p>
  </div>

  <div class="divider"></div>

  <h2>How to Score Higher</h2>
  <div class="card">
    <h3 style="margin-top:0;">Happens automatically</h3>
    <div class="signal-row"><span class="signal-name">Wallet gets older</span><span class="signal-pts" style="color:#22c55e;">+age pts</span></div>
    <div class="signal-row"><span class="signal-name">More successful transactions</span><span class="signal-pts" style="color:#22c55e;">+volume pts</span></div>
    <div class="signal-row"><span class="signal-name">Interacting with ERC-8257 tools on Base</span><span class="signal-pts" style="color:#22c55e;">+tool usage pts</span></div>
    <div class="signal-row"><span class="signal-name">Transacting with trusted counterparties</span><span class="signal-pts" style="color:#22c55e;">+relationship pts</span></div>
  </div>
  <div class="card">
    <h3 style="margin-top:0;">Actions you can take</h3>
    <div class="signal-row"><span class="signal-name">Get endorsed by wallets you've transacted with</span><span class="signal-pts" style="color:#22c55e;">+up to 10 pts</span></div>
    <div class="signal-row"><span class="signal-name">Accumulate positive outcome reports</span><span class="signal-pts" style="color:#22c55e;">+up to 5 pts</span></div>
    <div class="signal-row"><span class="signal-name">Declare your permission scope</span><span class="signal-pts" style="color:#22c55e;">visible in report</span></div>
    <div class="signal-row"><span class="signal-name">Register as ERC-8004 agent</span><span class="signal-pts" style="color:#6366f1;">+25 agent pts</span></div>
    <div class="signal-row"><span class="signal-name">Pass safety certifications</span><span class="signal-pts" style="color:#6366f1;">+5 pts each</span></div>
  </div>

  <div class="divider"></div>

  <div style="text-align:center;padding-top:8px;">
    <div style="font-size:10px;color:#2d2d44;font-family:'Space Mono',monospace;margin-bottom:12px;">AGENTCHECK · ERC-8257 TOOL #13 · BASE · OPEN SOURCE</div>
    <div style="font-size:13px;color:#4a5568;">
      <a href="https://agentcheck-bice.vercel.app/api/report?wallet=0x6f33e7b6460daC803c53ab6e02da8C675633d516">See a live report →</a>
      &nbsp;·&nbsp;
      <a href="https://github.com/BTSHTKRZY/agentcheck">Source code →</a>
      &nbsp;·&nbsp;
      <a href="https://agentcheck-bice.vercel.app/api/check?wallet=0x6f33e7b6460daC803c53ab6e02da8C675633d516">Raw JSON →</a>
    </div>
    <div style="margin-top:16px;font-size:12px;color:#2d2d44;">Scores improve as data accumulates. The model self-calibrates over time.</div>
  </div>

</div>
</body>
</html>`;

  return res.status(200).send(html);
}
