import type { VercelRequest, VercelResponse } from "@vercel/node";

const BASE_URL = "https://agentcheck-bice.vercel.app";

function ratingColor(rating: string): string {
  if (["AAA","AA","A"].includes(rating))   return "#22c55e";
  if (["BBB","BB"].includes(rating))        return "#eab308";
  if (["B","CCC"].includes(rating))         return "#f97316";
  return "#ef4444";
}

function ratingBg(rating: string): string {
  if (["AAA","AA","A"].includes(rating))   return "#052e16";
  if (["BBB","BB"].includes(rating))        return "#1c1917";
  if (["B","CCC"].includes(rating))         return "#1c0f00";
  return "#1c0000";
}

function scoreBar(score: number, color: string): string {
  return `
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="flex:1;height:6px;background:#1e1e2e;border-radius:3px;overflow:hidden;">
        <div style="width:${score}%;height:100%;background:${color};border-radius:3px;transition:width 0.5s;"></div>
      </div>
      <span style="font-size:13px;color:${color};font-family:'Space Mono',monospace;font-weight:700;min-width:32px;text-align:right;">${score}</span>
    </div>`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const wallet = (req.query?.wallet || "").toString().toLowerCase().trim();

  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
    return res.status(400).send(`
      <html><body style="background:#07070D;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;">
          <div style="font-size:40px;margin-bottom:16px;">⚠</div>
          <div style="font-size:16px;color:#ffffff60;">Provide a valid wallet address</div>
          <div style="margin-top:16px;font-size:12px;color:#ffffff30;font-family:monospace;">
            /api/report?wallet=0x...
          </div>
        </div>
      </body></html>
    `);
  }

  // Fetch data from our own check endpoint
  let data: any = null;
  try {
    const r = await fetch(`${BASE_URL}/api/check?wallet=${wallet}`);
    data = await r.json();
  } catch {
    return res.status(500).send("<html><body>Failed to fetch rating data.</body></html>");
  }

  if (!data || data.error) {
    return res.status(404).send("<html><body>No data found for this wallet.</body></html>");
  }

  const rating      = data.rating || "?";
  const rCol        = ratingColor(rating);
  const rBg         = ratingBg(rating);
  const trust       = data.trust_score || 0;
  const risk        = data.risk_score  || 0;
  const agent       = data.agent_score || 0;
  const composite   = data.composite   || 0;
  const verdict     = data.verdict     || "";
  const outlook     = data.outlook     || "stable";
  const checkedAt   = data.checked_at  || new Date().toISOString();
  const report      = data.report      || {};
  const walletData  = report.wallet_data || {};
  const forensics   = report.forensics   || {};
  const agentId     = report.agent_identity || {};
  const certs       = report.certifications || {};
  const community   = report.community      || {};
  const scope       = report.permission_scope || {};
  const highlights  = report.highlights || [];
  const riskFlags   = report.risk_flags || [];
  const breakdown   = report.trust_breakdown || {};

  const outlookIcon = outlook === "positive" ? "↑" : outlook === "negative" ? "↓" : "→";
  const outlookCol  = outlook === "positive" ? "#22c55e" : outlook === "negative" ? "#ef4444" : "#94a3b8";

  const shortWallet = `${wallet.slice(0,8)}...${wallet.slice(-6)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>AgentCheck — ${shortWallet}</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#07070D;color:#e2e8f0;font-family:'Inter',sans-serif;min-height:100vh;}
    .container{max-width:860px;margin:0 auto;padding:40px 20px 80px;}
    .card{background:#0f0f1a;border:1px solid #1e1e3a;border-radius:12px;padding:24px;margin-bottom:16px;}
    .card-title{font-size:10px;letter-spacing:0.16em;color:#4a5568;font-family:'Space Mono',monospace;text-transform:uppercase;margin-bottom:16px;}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
    .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
    .stat-card{background:#07070D;border:1px solid #1e1e3a;border-radius:8px;padding:16px;}
    .stat-label{font-size:10px;letter-spacing:0.12em;color:#4a5568;font-family:'Space Mono',monospace;text-transform:uppercase;margin-bottom:6px;}
    .stat-value{font-size:18px;font-weight:600;color:#e2e8f0;font-family:'Space Mono',monospace;}
    .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:11px;font-family:'Space Mono',monospace;font-weight:700;}
    .flag{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1c0000;border:1px solid #7f1d1d;border-radius:6px;font-size:12px;color:#fca5a5;margin-bottom:6px;}
    .highlight{display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #1e1e3a;}
    .highlight:last-child{border-bottom:none;}
    .cert-item{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e1e3a;}
    .cert-item:last-child{border-bottom:none;}
    .divider{height:1px;background:#1e1e3a;margin:16px 0;}
    a{color:#6366f1;text-decoration:none;}
    a:hover{text-decoration:underline;}
    @media(max-width:600px){.grid2,.grid3{grid-template-columns:1fr;}.hero{flex-direction:column;text-align:center;}}
  </style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;flex-wrap:wrap;gap:12px;">
    <div>
      <div style="font-size:10px;letter-spacing:0.24em;color:#6366f1;font-family:'Space Mono',monospace;margin-bottom:4px;">AGENTCHECK</div>
      <div style="font-size:22px;font-weight:600;color:#e2e8f0;font-family:'Space Mono',monospace;">${shortWallet}</div>
      <div style="font-size:11px;color:#4a5568;margin-top:4px;font-family:'Space Mono',monospace;">${wallet}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;color:#4a5568;font-family:'Space Mono',monospace;">CHECKED AT</div>
      <div style="font-size:12px;color:#94a3b8;font-family:'Space Mono',monospace;">${new Date(checkedAt).toUTCString()}</div>
      <div style="font-size:10px;color:#4a5568;margin-top:4px;font-family:'Space Mono',monospace;">ERC-8257 TOOL #13 · BASE</div>
    </div>
  </div>

  <!-- Hero rating card -->
  <div class="card" style="background:${rBg};border-color:${rCol}30;margin-bottom:24px;">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:20px;">
      <div style="display:flex;align-items:center;gap:24px;">
        <div style="text-align:center;">
          <div style="font-size:72px;font-weight:700;color:${rCol};font-family:'Space Mono',monospace;line-height:1;">${rating}</div>
          <div style="font-size:10px;letter-spacing:0.16em;color:${rCol}80;font-family:'Space Mono',monospace;margin-top:4px;">RATING</div>
        </div>
        <div>
          <div style="font-size:15px;color:#e2e8f0;line-height:1.5;max-width:360px;">${verdict}</div>
          <div style="margin-top:12px;display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;letter-spacing:0.12em;color:#4a5568;font-family:'Space Mono',monospace;">OUTLOOK</span>
            <span style="font-size:13px;color:${outlookCol};font-family:'Space Mono',monospace;font-weight:700;">${outlookIcon} ${outlook.toUpperCase()}</span>
          </div>
        </div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:42px;font-weight:700;color:${rCol};font-family:'Space Mono',monospace;line-height:1;">${composite}</div>
        <div style="font-size:10px;letter-spacing:0.12em;color:${rCol}80;font-family:'Space Mono',monospace;margin-top:4px;">COMPOSITE</div>
      </div>
    </div>
  </div>

  <!-- Three scores -->
  <div class="grid3" style="margin-bottom:16px;">
    <div class="stat-card">
      <div class="stat-label">Trust Score</div>
      <div class="stat-value" style="color:#22c55e;margin-bottom:8px;">${trust}</div>
      ${scoreBar(trust, "#22c55e")}
      <div style="font-size:10px;color:#4a5568;margin-top:8px;">On-chain behaviour</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Risk Score</div>
      <div class="stat-value" style="color:${risk > 50 ? "#ef4444" : "#22c55e"};margin-bottom:8px;">${risk}</div>
      ${scoreBar(risk, risk > 50 ? "#ef4444" : "#22c55e")}
      <div style="font-size:10px;color:#4a5568;margin-top:8px;">Lower is safer</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Agent Score</div>
      <div class="stat-value" style="color:#6366f1;margin-bottom:8px;">${agent}</div>
      ${scoreBar(agent, "#6366f1")}
      <div style="font-size:10px;color:#4a5568;margin-top:8px;">Agent identity signals</div>
    </div>
  </div>

  <!-- Risk flags (show only if present) -->
  ${riskFlags.length > 0 ? `
  <div class="card" style="border-color:#7f1d1d;background:#1c0000;margin-bottom:16px;">
    <div class="card-title" style="color:#f87171;">⚠ Risk Flags Detected</div>
    ${riskFlags.map((f: string) => `<div class="flag">🚩 ${f.replace(/_/g," ").toUpperCase()}</div>`).join("")}
  </div>` : ""}

  <!-- Wallet data + Agent identity -->
  <div class="grid2" style="margin-bottom:16px;">
    <div class="card">
      <div class="card-title">Wallet Data</div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:130px;">Age</span>
        <span style="font-size:13px;color:#e2e8f0;">${walletData.age_days ? `${walletData.age_days} days` : "—"}</span>
      </div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:130px;">First seen</span>
        <span style="font-size:13px;color:#e2e8f0;font-family:'Space Mono',monospace;">${formatDate(walletData.first_seen)}</span>
      </div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:130px;">Last active</span>
        <span style="font-size:13px;color:#e2e8f0;font-family:'Space Mono',monospace;">${formatDate(walletData.last_active)}</span>
      </div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:130px;">Transactions</span>
        <span style="font-size:13px;color:#e2e8f0;">${walletData.total_transactions || 0} recent</span>
      </div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:130px;">Success rate</span>
        <span style="font-size:13px;color:#22c55e;">${walletData.success_rate || "—"}</span>
      </div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:130px;">ETH balance</span>
        <span style="font-size:13px;color:#e2e8f0;">${walletData.eth_balance || "—"}</span>
      </div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:130px;">Contracts used</span>
        <span style="font-size:13px;color:#e2e8f0;">${walletData.unique_contracts || 0}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Agent Identity</div>
      <div style="margin-bottom:16px;">
        ${agentId.registered ? `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <span style="font-size:18px;">🤖</span>
            <div>
              <div style="font-size:14px;font-weight:600;color:#6366f1;">${agentId.name || "Registered Agent"}</div>
              <div style="font-size:11px;color:#4a5568;">${agentId.type || ""} ${agentId.level ? `· Level ${agentId.level}` : ""}</div>
            </div>
          </div>
          <div class="badge" style="background:#1e1b4b;color:#818cf8;border:1px solid #3730a3;">✓ ERC-8004 Registered</div>
        ` : `
          <div style="color:#4a5568;font-size:13px;margin-bottom:12px;">Not a registered ERC-8004 agent</div>
          <div class="badge" style="background:#1e1e2e;color:#4a5568;border:1px solid #2d2d44;">Human wallet</div>
        `}
      </div>
      <div class="divider"></div>
      <div class="card-title" style="margin-top:16px;">Forensics</div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:100px;">Provider</span>
        <span style="font-size:12px;color:#94a3b8;">GetBlock Fraud Check</span>
      </div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:100px;">Risk level</span>
        <span style="font-size:13px;font-weight:600;color:${forensics.risk_level === "LOW" ? "#22c55e" : forensics.risk_level === "MEDIUM" ? "#eab308" : "#ef4444"};">${forensics.risk_level || "—"}</span>
      </div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:100px;">Sanctioned</span>
        <span style="font-size:13px;color:${forensics.sanctioned ? "#ef4444" : "#22c55e"};">${forensics.sanctioned ? "⚠ YES" : "✓ No"}</span>
      </div>
    </div>
  </div>

  <!-- Trust score breakdown -->
  <div class="card" style="margin-bottom:16px;">
    <div class="card-title">Trust Score Breakdown</div>
    <div class="grid2">
      ${Object.entries(breakdown).map(([key, val]: [string, any]) => `
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:11px;color:#4a5568;text-transform:capitalize;">${key.replace(/_/g," ")}</span>
            <span style="font-size:11px;color:#94a3b8;font-family:'Space Mono',monospace;">${val}</span>
          </div>
          ${scoreBar(Math.round((val / 20) * 100), "#6366f1")}
        </div>
      `).join("")}
    </div>
  </div>

  <!-- Certifications + Community -->
  <div class="grid2" style="margin-bottom:16px;">
    <div class="card">
      <div class="card-title">Safety Certifications</div>
      ${["prompt_injection","secret_protection","unsafe_action_gating"].map(cert => {
        const passed = (certs.passed || []).includes(cert);
        return `
          <div class="cert-item">
            <span style="font-size:13px;color:#e2e8f0;text-transform:capitalize;">${cert.replace(/_/g," ")}</span>
            <span class="badge" style="background:${passed ? "#052e16" : "#1c0f00"};color:${passed ? "#22c55e" : "#f97316"};border:1px solid ${passed ? "#166534" : "#9a3412"};">
              ${passed ? "✓ PASS" : "PENDING"}
            </span>
          </div>`;
      }).join("")}
      <div style="margin-top:12px;font-size:11px;color:#4a5568;">Submit for certification via POST /api/certify</div>
    </div>

    <div class="card">
      <div class="card-title">Community</div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:140px;">Endorsements</span>
        <span style="font-size:16px;font-weight:600;color:#e2e8f0;font-family:'Space Mono',monospace;">${community.endorsements || 0}</span>
      </div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:140px;">Outcomes tracked</span>
        <span style="font-size:16px;font-weight:600;color:#e2e8f0;font-family:'Space Mono',monospace;">${community.outcomes_tracked || 0}</span>
      </div>
      <div class="highlight">
        <span style="color:#4a5568;font-size:12px;min-width:140px;">Positive outcomes</span>
        <span style="font-size:16px;font-weight:600;color:#22c55e;font-family:'Space Mono',monospace;">${community.positive_outcomes || 0}</span>
      </div>
      ${(community.endorsers || []).length > 0 ? `
        <div style="margin-top:12px;">
          <div style="font-size:10px;color:#4a5568;margin-bottom:6px;letter-spacing:0.1em;">ENDORSED BY</div>
          ${community.endorsers.map((e: any) => `
            <div style="font-size:11px;color:#6366f1;font-family:'Space Mono',monospace;margin-bottom:3px;">${e.endorser || e}</div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  </div>

  <!-- Permission scope -->
  <div class="card" style="margin-bottom:16px;">
    <div class="card-title">Permission Scope</div>
    ${scope.declared ? `
      <div class="grid2">
        ${scope.max_transaction_eth ? `<div class="highlight"><span style="color:#4a5568;font-size:12px;min-width:160px;">Max transaction</span><span style="font-size:13px;color:#e2e8f0;">${scope.max_transaction_eth} ETH</span></div>` : ""}
        ${scope.requires_approval_above_eth ? `<div class="highlight"><span style="color:#4a5568;font-size:12px;min-width:160px;">Approval required above</span><span style="font-size:13px;color:#e2e8f0;">${scope.requires_approval_above_eth} ETH</span></div>` : ""}
        ${scope.allowed_asset_classes ? `<div class="highlight"><span style="color:#4a5568;font-size:12px;min-width:160px;">Allowed assets</span><span style="font-size:13px;color:#e2e8f0;">${scope.allowed_asset_classes.join(", ")}</span></div>` : ""}
        ${scope.operating_hours ? `<div class="highlight"><span style="color:#4a5568;font-size:12px;min-width:160px;">Operating hours</span><span style="font-size:13px;color:#e2e8f0;">${scope.operating_hours}</span></div>` : ""}
        ${scope.jurisdiction ? `<div class="highlight"><span style="color:#4a5568;font-size:12px;min-width:160px;">Jurisdiction</span><span style="font-size:13px;color:#e2e8f0;">${scope.jurisdiction}</span></div>` : ""}
      </div>
    ` : `
      <div style="color:#4a5568;font-size:13px;">No permission scope declared.</div>
      <div style="font-size:11px;color:#4a5568;margin-top:6px;">Declare via POST /api/scope to show operating limits to counterparties.</div>
    `}
  </div>

  <!-- Highlights -->
  ${highlights.length > 0 ? `
  <div class="card" style="margin-bottom:16px;">
    <div class="card-title">Key Signals</div>
    ${highlights.map((h: string) => `
      <div class="highlight">
        <span style="color:#22c55e;flex-shrink:0;">✓</span>
        <span style="font-size:13px;color:#94a3b8;">${h}</span>
      </div>
    `).join("")}
  </div>` : ""}

  <!-- Footer -->
  <div style="text-align:center;margin-top:40px;padding-top:24px;border-top:1px solid #1e1e3a;">
    <div style="font-size:12px;color:#4a5568;font-family:'Space Mono',monospace;margin-bottom:8px;">AGENTCHECK · ERC-8257 TOOL #13 · BASE</div>
    <div style="font-size:11px;color:#2d2d44;">
      <a href="${BASE_URL}/api/check?wallet=${wallet}" style="color:#6366f1;">JSON API</a>
      &nbsp;·&nbsp;
      <a href="https://github.com/BTSHTKRZY/agentcheck" style="color:#6366f1;">Source</a>
      &nbsp;·&nbsp;
      <a href="https://basescan.org/tx/0xd45f3f8e936da4ee357b2223dc1913838a3edf5aa58b4242d6ddf68ab8e5c367" style="color:#6366f1;">On-chain</a>
    </div>
    <div style="font-size:10px;color:#2d2d44;margin-top:8px;">
      Data: Etherscan v2 · GetBlock Fraud Check · Normies ERC-8004 Registry · AgentCheck Community
    </div>
  </div>

</div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(html);
}
