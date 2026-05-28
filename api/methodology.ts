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
    .tip{background:#0a0a1a;border:1px solid #6366f130;border-radius:8px;padding:16px 20px;margin:16px 0;}
    .tip-title{font-size:12px;font-family:'Space Mono',monospace;letter-spacing:0.1em;color:#6366f1;margin-bottom:8px;}
    a{color:#6366f1;text-decoration:none;}
    a:hover{text-decoration:underline;}
    code{font-family:'Space Mono',monospace;font-size:12px;background:#0a0a1a;padding:12px 16px;border-radius:8px;display:block;color:#94a3b8;overflow-x:auto;margin:8px 0 16px;}
    .divider{height:1px;background:#1e1e3a;margin:32px 0;}
  </style>
</head>
<body>
<div class="container">

  <div style="margin-bottom:40px;">
    <div style="font-size:10px;letter-spacing:0.24em;color:#6366f1;font-family:'Space Mono',monospace;margin-bottom:8px;">AGENTCHECK · ERC-8257 TOOL #13</div>
    <h1>How Scores Work</h1>
    <p style="margin-top:8px;font-size:16px;">A plain-language explanation of how AgentCheck rates any Ethereum wallet or AI agent.</p>
  </div>

  <h2>The Rating Scale</h2>
  <p>Every wallet gets a letter grade based on a composite score from 0 to 100. The scale is intentionally conservative — strict scoring with limited data is safer than optimistic scoring that creates false confidence.</p>

  <div class="card">
    <div class="grade-row">
      <div class="grade" style="color:#22c55e;">AAA</div>
      <div><div class="grade-desc">Exceptional. Highest trust. Fully certified agent.</div><div class="grade-note" style="color:#22c55e50;">Composite 90+</div></div>
    </div>
    <div class="grade-row">
      <div class="grade" style="color:#22c55e;">AA</div>
      <div><div class="grade-desc">Strong. Established track record. Safe to transact.</div><div class="grade-note" style="color:#22c55e50;">Composite 80–89</div></div>
    </div>
    <div class="grade-row">
      <div class="grade" style="color:#22c55e;">A</div>
      <div><div class="grade-desc">Good. Solid history. Generally safe to transact.</div><div class="grade-note" style="color:#22c55e50;">Composite 70–79</div></div>
    </div>
    <div class="grade-row">
      <div class="grade" style="color:#eab308;">BBB</div>
      <div>
        <div class="grade-desc">Adequate. Limited visible history, no adverse flags.</div>
        <div class="grade-note" style="color:#eab308;font-size:12px;margin-top:4px;">⭐ Most legitimate active wallets start here. This is a good score.</div>
        <div class="grade-note" style="color:#eab30870;">Composite 60–69</div>
      </div>
    </div>
    <div class="grade-row">
      <div class="grade" style="color:#eab308;">BB</div>
      <div>
        <div class="grade-desc">Newer wallet or limited visible history. No flags.</div>
        <div class="grade-note" style="color:#eab308;font-size:12px;margin-top:4px;">⭐ Also a solid score — means clean, just less history visible.</div>
        <div class="grade-note" style="color:#eab30870;">Composite 50–59 · Floor for wallets with real history and no flags</div>
      </div>
    </div>
    <div class="grade-row">
      <div class="grade" style="color:#f97316;">B</div>
      <div><div class="grade-desc">Limited data or minor concerns. Proceed carefully.</div><div class="grade-note" style="color:#f9731650;">Composite 40–49</div></div>
    </div>
    <div class="grade-row">
      <div class="grade" style="color:#f97316;">CCC</div>
      <div><div class="grade-desc">Active risk flags. Avoid high-value transactions.</div><div class="grade-note" style="color:#f9731650;">Composite 30–39</div></div>
    </div>
    <div class="grade-row">
      <div class="grade" style="color:#ef4444;">CC</div>
      <div><div class="grade-desc">Multiple serious flags. Do not transact.</div><div class="grade-note" style="color:#ef444450;">Composite 20–29</div></div>
    </div>
    <div class="grade-row">
      <div class="grade" style="color:#ef4444;">C</div>
      <div><div class="grade-desc">High risk. Known adverse activity.</div><div class="grade-note" style="color:#ef444450;">Composite 10–19</div></div>
    </div>
    <div class="grade-row">
      <div class="grade" style="color:#ef4444;">D</div>
      <div><div class="grade-desc">Confirmed malicious or sanctioned. Do not transact.</div><div class="grade-note" style="color:#ef444450;">Composite 0–9</div></div>
    </div>
  </div>

  <div class="tip">
    <div class="tip-title">WHY BB IS A GOOD SCORE</div>
    <p style="margin:0;font-size:14px;">AgentCheck uses a floor system — any wallet with a real transaction history and no serious flags cannot go below BB. If you see BB, it means the wallet is clean. The score is limited by data visibility, not by anything the wallet has done wrong.</p>
  </div>

  <div class="divider"></div>

  <h2>The Three Scores</h2>
  <p>The composite score is weighted from three separate scores. Each measures something different.</p>

  <h3>Trust Score — 50% of composite</h3>
  <p>Built from on-chain behaviour. Higher trust = longer history, more transactions, cleaner record.</p>
  <div class="card">
    <div class="signal-row"><span class="signal-name">Wallet age</span><span class="signal-pts">up to 15 pts</span></div>
    <div class="signal-row"><span class="signal-name">Transaction volume</span><span class="signal-pts">up to 15 pts</span></div>
    <div class="signal-row"><span class="signal-name">Transaction success rate</span><span class="signal-pts">up to 20 pts</span></div>
    <div class="signal-row"><span class="signal-name">Protocol diversity</span><span class="signal-pts">up to 10 pts</span></div>
    <div class="signal-row"><span class="signal-name">Community endorsements</span><span class="signal-pts">up to 10 pts</span></div>
    <div class="signal-row"><span class="signal-name">Verified transaction outcomes</span><span class="signal-pts">up to 5 pts</span></div>
    <div class="signal-row"><span class="signal-name">Payment history (x402) · coming soon</span><span class="signal-pts">up to 15 pts</span></div>
    <div class="signal-row"><span class="signal-name">ERC-8257 tool usage · coming soon</span><span class="signal-pts">up to 10 pts</span></div>
  </div>

  <h3>Risk Score — 30% of composite (lower is safer)</h3>
  <p>Built from forensic screening. A risk score of 20 means low risk. A score of 90 means serious flags.</p>
  <div class="card">
    <div class="signal-row"><span class="signal-name">GetBlock forensic risk score</span><span class="signal-pts">baseline</span></div>
    <div class="signal-row"><span class="signal-name">Sanctions (OFAC / EU / UN)</span><span class="signal-pts">instant D if flagged</span></div>
    <div class="signal-row"><span class="signal-name">Darkweb transaction history</span><span class="signal-pts">score → 90+</span></div>
    <div class="signal-row"><span class="signal-name">Phishing association</span><span class="signal-pts">score → 80+</span></div>
    <div class="signal-row"><span class="signal-name">Rug pull history</span><span class="signal-pts">score → 85+</span></div>
    <div class="signal-row"><span class="signal-name">Mixer / tumbler interaction</span><span class="signal-pts">score → 75+</span></div>
  </div>

  <h3>Agent Score — 20% of composite</h3>
  <p>Only relevant for AI agents. Zero for human wallets — that is correct and expected.</p>
  <div class="card">
    <div class="signal-row"><span class="signal-name">ERC-8004 registration</span><span class="signal-pts">25 pts</span></div>
    <div class="signal-row"><span class="signal-name">Agent binding confirmed (OpenSea API)</span><span class="signal-pts">15 pts</span></div>
    <div class="signal-row"><span class="signal-name">Declared capabilities</span><span class="signal-pts">up to 10 pts</span></div>
    <div class="signal-row"><span class="signal-name">Safety certifications (3 available)</span><span class="signal-pts">5 pts each</span></div>
    <div class="signal-row"><span class="signal-name">ERC-6551 TBA wallet · coming soon</span><span class="signal-pts">15 pts</span></div>
    <div class="signal-row"><span class="signal-name">ERC-8257 tool usage · coming soon</span><span class="signal-pts">up to 15 pts</span></div>
  </div>

  <div class="divider"></div>

  <h2>How to Score Higher</h2>
  <p>Scores improve as more data becomes available. Here is exactly what moves the needle.</p>

  <div class="card">
    <h3 style="margin-top:0;">Happens automatically over time</h3>
    <div class="signal-row"><span class="signal-name">Wallet gets older</span><span class="signal-pts" style="color:#22c55e;">+age points</span></div>
    <div class="signal-row"><span class="signal-name">More successful transactions</span><span class="signal-pts" style="color:#22c55e;">+volume points</span></div>
    <div class="signal-row"><span class="signal-name">Interacting with more protocols</span><span class="signal-pts" style="color:#22c55e;">+diversity points</span></div>
  </div>

  <div class="card">
    <h3 style="margin-top:0;">Things you can do right now</h3>
    <div class="signal-row"><span class="signal-name">Get endorsed by wallets you have transacted with</span><span class="signal-pts" style="color:#22c55e;">+up to 10 pts</span></div>
    <div class="signal-row"><span class="signal-name">Accumulate positive outcome reports</span><span class="signal-pts" style="color:#22c55e;">+up to 5 pts</span></div>
    <div class="signal-row"><span class="signal-name">Declare your permission scope</span><span class="signal-pts" style="color:#22c55e;">visible in report</span></div>
    <div class="signal-row"><span class="signal-name">Register as ERC-8004 agent</span><span class="signal-pts" style="color:#6366f1;">+25 agent pts</span></div>
    <div class="signal-row"><span class="signal-name">Pass safety certifications</span><span class="signal-pts" style="color:#6366f1;">+5 pts each</span></div>
  </div>

  <div class="tip">
    <div class="tip-title">ENDORSE A WALLET YOU TRUST</div>
    <code>POST agentcheck-bice.vercel.app/api/endorse
{
  "endorser": "0xYOUR_WALLET",
  "endorsed": "0xTHEIR_WALLET",
  "context": "successful NFT trade"
}</code>
    <p style="margin:0;font-size:13px;color:#4a5568;">Each endorsement adds to the endorsed wallet's trust score. The more endorsements, the higher the score.</p>
  </div>

  <div class="divider"></div>

  <h2>Current Limitations</h2>
  <p>AgentCheck is early infrastructure. These constraints exist today and are being addressed.</p>

  <div class="card">
    <div class="signal-row">
      <div>
        <div class="signal-name">Wallet age may be hidden</div>
        <div style="font-size:12px;color:#4a5568;margin-top:3px;">Etherscan free tier returns the 100 most recent transactions. For very active wallets the wallet may appear newer than it actually is. We hide the age rather than show a misleading figure.</div>
      </div>
    </div>
    <div class="signal-row">
      <div>
        <div class="signal-name">100 transaction window</div>
        <div style="font-size:12px;color:#4a5568;margin-top:3px;">Volume and success rate are calculated from 100 recent transactions only. Etherscan Pro removes this limit and will unlock higher scores for established wallets.</div>
      </div>
    </div>
    <div class="signal-row">
      <div>
        <div class="signal-name">GetBlock free tier — 5 forensic checks per day</div>
        <div style="font-size:12px;color:#4a5568;margin-top:3px;">Under high load forensic data may fall back to defaults. Upgrading unlocks deeper screening.</div>
      </div>
    </div>
    <div class="signal-row" style="border-bottom:none;">
      <div>
        <div class="signal-name">x402 payments and ERC-8257 usage not yet tracked</div>
        <div style="font-size:12px;color:#4a5568;margin-top:3px;">These signals are in the model but not yet connected to live data. Scores will increase for active protocol users when wired up.</div>
      </div>
    </div>
  </div>

  <div class="divider"></div>

  <h2>The Formula</h2>
  <div class="card" style="font-family:'Space Mono',monospace;font-size:13px;color:#94a3b8;line-height:2;">
    <div>composite = (trust × 0.5) + ((100 − risk) × 0.3) + (agent × 0.2)</div>
    <div style="margin-top:8px;color:#4a5568;font-size:11px;">Floor: wallets with real history and no serious flags → minimum BB (composite 50)</div>
    <div style="color:#4a5568;font-size:11px;">Override: sanctioned wallets → instant D regardless of other signals</div>
  </div>

  <div class="divider"></div>

  <div style="text-align:center;padding-top:8px;">
    <div style="font-size:10px;color:#2d2d44;font-family:'Space Mono',monospace;margin-bottom:12px;">AGENTCHECK · ERC-8257 TOOL #13 · BASE · OPEN SOURCE</div>
    <div style="font-size:13px;color:#4a5568;">
      <a href="https://agentcheck-bice.vercel.app/api/report?wallet=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045">See a live report →</a>
      &nbsp;·&nbsp;
      <a href="https://github.com/BTSHTKRZY/agentcheck">Source code →</a>
      &nbsp;·&nbsp;
      <a href="https://agentcheck-bice.vercel.app/api/check?wallet=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045">Raw JSON →</a>
    </div>
    <div style="margin-top:16px;font-size:12px;color:#2d2d44;">Scores improve as data accumulates. The model self-calibrates over time.</div>
  </div>

</div>
</body>
</html>`;

  return res.status(200).send(html);
}
