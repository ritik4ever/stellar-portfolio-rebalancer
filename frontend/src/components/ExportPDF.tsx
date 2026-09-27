/**
 * ExportPDF — client-side PDF portfolio report generator.
 *
 * Approach: builds a self-contained HTML document, injects it into a hidden
 * <iframe>, then calls iframe.contentWindow.print(). The browser's native
 * print-to-PDF path produces proper vector output (text selectable, links
 * live, no rasterisation artefacts) with zero third-party dependencies.
 *
 * Charts are rendered as inline SVG so they appear as true vector graphics in
 * the PDF.  The allocation pie and performance sparkline are drawn programmatically
 * from the data passed via props — no dependency on recharts or canvas APIs.
 *
 * Sections generated:
 *  1. Cover page  — portfolio title, wallet, date, total value, day change
 *  2. Allocation  — pie chart (SVG) + allocation table (asset / target % / value / price / 24h)
 *  3. Performance — sparkline chart (SVG) + summary stats
 *  4. Rebalance history — table of recent events
 *  5. Tax summary — aggregate fee and trade count per asset
 */

import React, { useCallback, useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { useRebalanceHistory } from '../hooks/queries/useHistoryQuery'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AllocationEntry {
    name: string
    value: number   // target allocation %
    amount: number  // USD amount
    color: string
}

interface PriceRow {
    price?: number
    change?: number
    [key: string]: unknown
}

interface PerformancePoint {
    date: string
    value: number
}

interface RebalanceEvent {
    id: string
    timestamp: string
    trigger: string
    trades: number
    gasUsed: string
    status: 'completed' | 'failed' | 'pending'
    details?: {
        fromAsset?: string
        toAsset?: string
        amount?: number
        gasFeeXlm?: number
        gasFeeUsd?: number
        totalSlippageBps?: number
        riskLevel?: string
    }
}

export interface ExportPDFProps {
    portfolioData: {
        id: string
        totalValue: number
        dayChange?: number
        lastRebalance?: string
        needsRebalance?: boolean
    } | null
    allocationData: AllocationEntry[]
    prices: Record<string, PriceRow>
    performanceData: PerformancePoint[]
    publicKey: string | null
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

/** Build a donut-segment SVG path command from start to end angle. */
function pieSegmentPath(
    cx: number,
    cy: number,
    r: number,
    innerR: number,
    startDeg: number,
    endDeg: number,
): string {
    const toRad = (d: number) => (d * Math.PI) / 180
    const x1 = cx + r * Math.cos(toRad(startDeg - 90))
    const y1 = cy + r * Math.sin(toRad(startDeg - 90))
    const x2 = cx + r * Math.cos(toRad(endDeg - 90))
    const y2 = cy + r * Math.sin(toRad(endDeg - 90))
    const ix1 = cx + innerR * Math.cos(toRad(endDeg - 90))
    const iy1 = cy + innerR * Math.sin(toRad(endDeg - 90))
    const ix2 = cx + innerR * Math.cos(toRad(startDeg - 90))
    const iy2 = cy + innerR * Math.sin(toRad(startDeg - 90))
    const large = endDeg - startDeg > 180 ? 1 : 0
    return [
        `M ${x1} ${y1}`,
        `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
        `L ${ix1} ${iy1}`,
        `A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2}`,
        'Z',
    ].join(' ')
}

function buildPieSVG(allocations: AllocationEntry[]): string {
    if (!allocations.length) return '<text x="90" y="90" text-anchor="middle" fill="#6b7280" font-size="12">No data</text>'
    const cx = 90, cy = 90, r = 75, innerR = 40
    const total = allocations.reduce((s, a) => s + a.value, 0) || 1
    let cursor = 0
    const paths = allocations.map((a) => {
        const sweep = (a.value / total) * 360
        const path = pieSegmentPath(cx, cy, r, innerR, cursor, cursor + sweep - 0.5)
        cursor += sweep
        return `<path d="${path}" fill="${a.color}" stroke="white" stroke-width="1.5"/>`
    })
    return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
  ${paths.join('\n  ')}
  <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="11" fill="#374151" font-family="system-ui,sans-serif">Total</text>
  <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="10" fill="#6b7280" font-family="system-ui,sans-serif">allocation</text>
</svg>`
}

function buildSparklineSVG(points: PerformancePoint[]): string {
    if (points.length < 2) {
        return '<text x="200" y="60" text-anchor="middle" fill="#6b7280" font-size="12" font-family="system-ui,sans-serif">No data</text>'
    }
    const W = 400, H = 100, PAD = 8
    const vals = points.map((p) => p.value)
    const minV = Math.min(...vals)
    const maxV = Math.max(...vals)
    const range = maxV - minV || 1
    const xStep = (W - PAD * 2) / (points.length - 1)
    const toX = (i: number) => PAD + i * xStep
    const toY = (v: number) => PAD + (1 - (v - minV) / range) * (H - PAD * 2)

    const linePts = points.map((p, i) => `${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ')
    const areaClose = `${toX(points.length - 1).toFixed(1)},${(H - PAD).toFixed(1)} ${toX(0).toFixed(1)},${(H - PAD).toFixed(1)}`
    const isUp = vals[vals.length - 1] >= vals[0]
    const color = isUp ? '#10b981' : '#ef4444'
    const areaColor = isUp ? '#d1fae5' : '#fee2e2'

    // x-axis labels (first, middle, last)
    const labelIdxs = [0, Math.floor((points.length - 1) / 2), points.length - 1]
    const labels = labelIdxs
        .map((i) => `<text x="${toX(i).toFixed(1)}" y="${H}" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="system-ui,sans-serif">${points[i].date}</text>`)
        .join('\n  ')

    return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 12}" width="${W}" height="${H + 12}">
  <polygon points="${linePts} ${areaClose}" fill="${areaColor}" opacity="0.6"/>
  <polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
  ${labels}
</svg>`
}

// ─── Number formatters ─────────────────────────────────────────────────────────

function usd(v: number): string {
    return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function usdCompact(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
    if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}K`
    return usd(v)
}

function pct(v: number, decimals = 2): string {
    return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`
}

function formatPrice(v: number): string {
    if (v >= 1_000) return usd(v)
    if (v >= 1) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4, style: 'currency', currency: 'USD' })
    return v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6, style: 'currency', currency: 'USD' })
}

// ─── HTML document builder ────────────────────────────────────────────────────

interface BuildOptions {
    portfolioData: ExportPDFProps['portfolioData']
    allocationData: AllocationEntry[]
    prices: Record<string, PriceRow>
    performanceData: PerformancePoint[]
    rebalanceHistory: RebalanceEvent[]
    publicKey: string | null
    generatedAt: string
}

function buildReportHTML(opts: BuildOptions): string {
    const { portfolioData, allocationData, prices, performanceData, rebalanceHistory, publicKey, generatedAt } = opts
    const isDemo = !publicKey || portfolioData?.id === 'demo'
    const totalValue = portfolioData?.totalValue ?? 0
    const dayChange = portfolioData?.dayChange ?? 0
    const lastRebalance = portfolioData?.lastRebalance ?? '—'

    // ── Section 2: Allocation table rows ──────────────────────────────────────
    const allocationRows = allocationData.map((a) => {
        const priceRow = prices[a.name]
        const priceVal = typeof priceRow?.price === 'number' ? formatPrice(priceRow.price) : '—'
        const changeVal = typeof priceRow?.change === 'number'
            ? `<span style="color:${priceRow.change >= 0 ? '#059669' : '#dc2626'}">${pct(priceRow.change)}</span>`
            : '—'
        return `
        <tr>
          <td style="display:flex;align-items:center;gap:8px;padding:10px 12px;">
            <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${a.color};flex-shrink:0;"></span>
            <strong>${a.name}</strong>
          </td>
          <td style="padding:10px 12px;text-align:right;">${a.value.toFixed(1)}%</td>
          <td style="padding:10px 12px;text-align:right;">${usd(a.amount)}</td>
          <td style="padding:10px 12px;text-align:right;">${priceVal}</td>
          <td style="padding:10px 12px;text-align:right;">${changeVal}</td>
        </tr>`
    }).join('')

    // ── Section 4: Rebalance history rows ──────────────────────────────────────
    const historyRows = rebalanceHistory.slice(0, 20).map((ev) => {
        const date = new Date(ev.timestamp)
        const dateStr = Number.isFinite(date.getTime())
            ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : ev.timestamp
        const statusColor = ev.status === 'completed' ? '#059669' : ev.status === 'failed' ? '#dc2626' : '#d97706'
        const gasFee = ev.details?.gasFeeXlm != null ? `${ev.details.gasFeeXlm.toFixed(4)} XLM` : ev.gasUsed
        const slippage = ev.details?.totalSlippageBps != null
            ? `${(ev.details.totalSlippageBps / 100).toFixed(2)}%`
            : '—'
        return `
        <tr>
          <td style="padding:8px 12px;font-size:12px;">${dateStr}</td>
          <td style="padding:8px 12px;font-size:12px;">${ev.trigger}</td>
          <td style="padding:8px 12px;text-align:center;font-size:12px;">${ev.trades}</td>
          <td style="padding:8px 12px;text-align:right;font-size:12px;">${gasFee}</td>
          <td style="padding:8px 12px;text-align:right;font-size:12px;">${slippage}</td>
          <td style="padding:8px 12px;text-align:center;font-size:12px;">
            <span style="color:${statusColor};font-weight:600;">${ev.status}</span>
          </td>
        </tr>`
    }).join('')

    const historySection = rebalanceHistory.length === 0
        ? `<p style="color:#6b7280;font-style:italic;padding:16px 0;">No rebalance events recorded yet.</p>`
        : `
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;">Date</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;">Trigger</th>
              <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#374151;">Trades</th>
              <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:600;color:#374151;">Gas Fee</th>
              <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:600;color:#374151;">Slippage</th>
              <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#374151;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${historyRows}
          </tbody>
        </table>`

    // ── Section 5: Tax summary ─────────────────────────────────────────────────
    const taxByAsset: Record<string, { trades: number; feesXlm: number; volume: number }> = {}
    for (const ev of rebalanceHistory) {
        if (ev.status !== 'completed') continue
        const asset = ev.details?.fromAsset ?? ev.details?.toAsset ?? 'Unknown'
        if (!taxByAsset[asset]) taxByAsset[asset] = { trades: 0, feesXlm: 0, volume: 0 }
        taxByAsset[asset].trades += ev.trades
        taxByAsset[asset].feesXlm += ev.details?.gasFeeXlm ?? 0
        taxByAsset[asset].volume += ev.details?.amount ?? 0
    }
    const taxRows = Object.entries(taxByAsset).map(([asset, row]) => `
        <tr>
          <td style="padding:8px 12px;font-weight:600;">${asset}</td>
          <td style="padding:8px 12px;text-align:center;">${row.trades}</td>
          <td style="padding:8px 12px;text-align:right;">${row.feesXlm.toFixed(4)} XLM</td>
          <td style="padding:8px 12px;text-align:right;">${row.volume > 0 ? usd(row.volume) : '—'}</td>
        </tr>`).join('')
    const taxSection = Object.keys(taxByAsset).length === 0
        ? `<p style="color:#6b7280;font-style:italic;padding:16px 0;">No completed rebalances to summarise.</p>`
        : `
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;">Asset</th>
              <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#374151;">Trades</th>
              <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:600;color:#374151;">Total Fees (XLM)</th>
              <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:600;color:#374151;">Volume Traded</th>
            </tr>
          </thead>
          <tbody>${taxRows}</tbody>
        </table>`

    // ── Performance stats ──────────────────────────────────────────────────────
    const perfVals = performanceData.map((p) => p.value)
    const perfStart = perfVals[0] ?? totalValue
    const perfEnd = perfVals[perfVals.length - 1] ?? totalValue
    const perfChange = perfStart > 0 ? ((perfEnd - perfStart) / perfStart) * 100 : 0
    const perfHigh = Math.max(...perfVals, totalValue)
    const perfLow = Math.min(...perfVals, totalValue)

    // ── SVGs ──────────────────────────────────────────────────────────────────
    const pieSvg = buildPieSVG(allocationData)
    const sparkSvg = buildSparklineSVG(performanceData)

    const walletDisplay = publicKey
        ? `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
        : 'Demo Mode'

    const dayChangeColor = dayChange >= 0 ? '#059669' : '#dc2626'

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Portfolio Report — ${generatedAt}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 14px;
    color: #111827;
    background: #fff;
    line-height: 1.5;
  }
  @page {
    size: A4 portrait;
    margin: 20mm 16mm;
  }
  @media print {
    .page-break { page-break-before: always; }
    tbody tr { page-break-inside: avoid; }
  }

  /* ── Cover ── */
  .cover {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 260px;
    padding: 40px 0 32px;
    border-bottom: 3px solid #3b82f6;
    margin-bottom: 40px;
  }
  .cover-badge {
    display: inline-block;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 4px;
    margin-bottom: 16px;
  }
  .cover h1 {
    font-size: 28px;
    font-weight: 800;
    color: #111827;
    margin-bottom: 4px;
  }
  .cover .subtitle {
    font-size: 14px;
    color: #6b7280;
    margin-bottom: 32px;
  }
  .cover-stats {
    display: flex;
    gap: 48px;
    flex-wrap: wrap;
  }
  .cover-stat-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: #9ca3af;
    margin-bottom: 4px;
  }
  .cover-stat-value {
    font-size: 24px;
    font-weight: 700;
    color: #111827;
  }
  .cover-stat-sub {
    font-size: 12px;
    color: #6b7280;
    margin-top: 2px;
  }

  /* ── Sections ── */
  .section {
    margin-bottom: 40px;
  }
  .section-title {
    font-size: 16px;
    font-weight: 700;
    color: #111827;
    padding-bottom: 8px;
    border-bottom: 2px solid #e5e7eb;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title .number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #3b82f6;
    color: white;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; }
  tr:nth-child(even) td { background: #f9fafb; }
  td, th { border-bottom: 1px solid #e5e7eb; }

  /* ── Allocation layout ── */
  .alloc-layout {
    display: flex;
    gap: 32px;
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .alloc-chart { flex-shrink: 0; }
  .alloc-table { flex: 1; min-width: 280px; }

  /* ── Performance stats row ── */
  .perf-stats {
    display: flex;
    gap: 32px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .perf-stat {
    flex: 1;
    min-width: 100px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px 16px;
  }
  .perf-stat-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: #9ca3af;
    margin-bottom: 4px;
  }
  .perf-stat-value {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
  }

  /* ── Legend dots ── */
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #374151; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

  /* ── Footer ── */
  .footer {
    margin-top: 48px;
    padding-top: 12px;
    border-top: 1px solid #e5e7eb;
    font-size: 11px;
    color: #9ca3af;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>

<!-- ══════════════════════════════════════════════════════════ COVER PAGE ══ -->
<div class="cover">
  <div class="cover-badge">Stellar Portfolio Rebalancer</div>
  <h1>Portfolio Report</h1>
  <div class="subtitle">
    Wallet: ${walletDisplay}
    &nbsp;·&nbsp;
    Generated: ${generatedAt}
    ${isDemo ? '&nbsp;·&nbsp;<em>Demo data — connect wallet for live report</em>' : ''}
  </div>
  <div class="cover-stats">
    <div>
      <div class="cover-stat-label">Total Value</div>
      <div class="cover-stat-value">${usdCompact(totalValue)}</div>
      <div class="cover-stat-sub">${usd(totalValue)}</div>
    </div>
    <div>
      <div class="cover-stat-label">24h Change</div>
      <div class="cover-stat-value" style="color:${dayChangeColor}">${pct(dayChange)}</div>
      <div class="cover-stat-sub">${usd(Math.abs(totalValue * dayChange / 100))}</div>
    </div>
    <div>
      <div class="cover-stat-label">Assets</div>
      <div class="cover-stat-value">${allocationData.length}</div>
      <div class="cover-stat-sub">in portfolio</div>
    </div>
    <div>
      <div class="cover-stat-label">Last Rebalance</div>
      <div class="cover-stat-value" style="font-size:16px;">${lastRebalance}</div>
    </div>
  </div>
</div>

<!-- ════════════════════════════════════════════════════ ALLOCATION SECTION ══ -->
<div class="section">
  <div class="section-title">
    <span class="number">1</span>
    Asset Allocation
  </div>
  <div class="alloc-layout">
    <div class="alloc-chart">
      ${pieSvg}
      <div class="legend">
        ${allocationData.map((a) => `<div class="legend-item"><span class="legend-dot" style="background:${a.color}"></span>${a.name}</div>`).join('')}
      </div>
    </div>
    <div class="alloc-table">
      <table>
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#374151;">Asset</th>
            <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#374151;text-align:right;">Target</th>
            <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#374151;text-align:right;">Value</th>
            <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#374151;text-align:right;">Price</th>
            <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#374151;text-align:right;">24h</th>
          </tr>
        </thead>
        <tbody>
          ${allocationRows || '<tr><td colspan="5" style="padding:12px;color:#6b7280;text-align:center;">No allocation data</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- ════════════════════════════════════════════════════ PERFORMANCE SECTION ══ -->
<div class="section page-break">
  <div class="section-title">
    <span class="number">2</span>
    Performance
  </div>
  <div class="perf-stats">
    <div class="perf-stat">
      <div class="perf-stat-label">Period Change</div>
      <div class="perf-stat-value" style="color:${perfChange >= 0 ? '#059669' : '#dc2626'}">${pct(perfChange)}</div>
    </div>
    <div class="perf-stat">
      <div class="perf-stat-label">Period High</div>
      <div class="perf-stat-value">${usdCompact(perfHigh)}</div>
    </div>
    <div class="perf-stat">
      <div class="perf-stat-label">Period Low</div>
      <div class="perf-stat-value">${usdCompact(perfLow)}</div>
    </div>
    <div class="perf-stat">
      <div class="perf-stat-label">Data Points</div>
      <div class="perf-stat-value">${performanceData.length}</div>
    </div>
  </div>
  ${sparkSvg}
</div>

<!-- ════════════════════════════════════════════════ REBALANCE HISTORY SECTION ══ -->
<div class="section page-break">
  <div class="section-title">
    <span class="number">3</span>
    Rebalance History
    ${rebalanceHistory.length > 20 ? `<span style="font-size:11px;font-weight:400;color:#6b7280;">(showing most recent 20 of ${rebalanceHistory.length})</span>` : ''}
  </div>
  ${historySection}
</div>

<!-- ════════════════════════════════════════════════════════ TAX SUMMARY SECTION ══ -->
<div class="section">
  <div class="section-title">
    <span class="number">4</span>
    Tax Summary
  </div>
  <p style="font-size:12px;color:#6b7280;margin-bottom:16px;">
    Aggregate trade activity and gas fees per asset from completed rebalances.
    This is a convenience summary only — consult a tax professional for filing purposes.
  </p>
  ${taxSection}
</div>

<!-- ══════════════════════════════════════════════════════════════ FOOTER ══ -->
<div class="footer">
  <span>Stellar Portfolio Rebalancer · portfolio_report_${generatedAt.replace(/[^0-9-]/g, '').slice(0, 10)}.pdf</span>
  <span>Generated ${generatedAt}</span>
</div>

</body>
</html>`
}

// ─── Component ────────────────────────────────────────────────────────────────

const ExportPDF: React.FC<ExportPDFProps> = ({
    portfolioData,
    allocationData,
    prices,
    performanceData,
    publicKey,
}) => {
    const [generating, setGenerating] = useState(false)

    // Fetch rebalance history (demo or real)
    const portfolioId = portfolioData?.id ?? undefined
    const { data: historyData } = useRebalanceHistory(
        portfolioId && portfolioId !== 'demo' ? portfolioId : undefined,
        1,
        50,
    )

    // Build rebalance events: use API data when available, fall back to demo
    const rebalanceHistory: RebalanceEvent[] = (() => {
        if (historyData?.history?.length) return historyData.history as RebalanceEvent[]
        // Demo fallback
        const now = new Date()
        return [
            {
                id: 'demo-1',
                timestamp: new Date(now.getTime() - 2 * 3600_000).toISOString(),
                trigger: 'Threshold exceeded (8.2%)',
                trades: 3,
                gasUsed: '0.0234 XLM',
                status: 'completed',
                details: { fromAsset: 'XLM', toAsset: 'ETH', amount: 1200, gasFeeXlm: 0.0234, gasFeeUsd: 0.003, totalSlippageBps: 45, riskLevel: 'medium' },
            },
            {
                id: 'demo-2',
                timestamp: new Date(now.getTime() - 12 * 3600_000).toISOString(),
                trigger: 'Scheduled rebalance',
                trades: 2,
                gasUsed: '0.0156 XLM',
                status: 'completed',
                details: { fromAsset: 'USDC', toAsset: 'XLM', amount: 800, gasFeeXlm: 0.0156, gasFeeUsd: 0.002, totalSlippageBps: 20, riskLevel: 'low' },
            },
        ]
    })()

    const handleExport = useCallback(async () => {
        if (generating) return
        setGenerating(true)

        try {
            const today = new Date()
            const dateStr = today.toISOString().slice(0, 10) // YYYY-MM-DD
            const generatedAt = today.toLocaleString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            })
            const filename = `portfolio_report_${dateStr}.pdf`

            const html = buildReportHTML({
                portfolioData,
                allocationData,
                prices,
                performanceData,
                rebalanceHistory,
                publicKey,
                generatedAt,
            })

            // Create hidden iframe, write the report HTML, then print
            const iframe = document.createElement('iframe')
            iframe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:none;opacity:0;pointer-events:none;'
            iframe.setAttribute('aria-hidden', 'true')
            iframe.title = filename
            document.body.appendChild(iframe)

            const doc = iframe.contentDocument ?? iframe.contentWindow?.document
            if (!doc) throw new Error('Could not access iframe document')

            doc.open()
            doc.write(html)
            doc.close()

            // Give images/fonts a tick to settle, then print
            await new Promise<void>((resolve, reject) => {
                const cleanup = () => {
                    try { document.body.removeChild(iframe) } catch { /* already removed */ }
                    resolve()
                }

                // afterprint fires after the print dialog closes (or immediately on cancel)
                iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true })

                // Safety timeout — clean up even if afterprint never fires
                const fallback = setTimeout(cleanup, 60_000)
                iframe.contentWindow?.addEventListener('afterprint', () => clearTimeout(fallback), { once: true })

                setTimeout(() => {
                    try {
                        iframe.contentWindow?.focus()
                        iframe.contentWindow?.print()
                    } catch (e) {
                        clearTimeout(fallback)
                        reject(e)
                    }
                }, 250)
            })
        } catch (err) {
            console.error('[ExportPDF] Export failed:', err)
            // Surface a friendly alert rather than silently failing
            const message = err instanceof Error ? err.message : 'PDF export failed.'
            alert(`PDF export failed: ${message}\n\nTry using your browser's built-in print function (Ctrl+P / Cmd+P) instead.`)
        } finally {
            setGenerating(false)
        }
    }, [generating, portfolioData, allocationData, prices, performanceData, rebalanceHistory, publicKey])

    const isDisabled = generating || !portfolioData

    return (
        <button
            type="button"
            onClick={handleExport}
            disabled={isDisabled}
            aria-label={generating ? 'Generating PDF report…' : 'Export portfolio as PDF report'}
            title="Export portfolio report as PDF (client-side, no server call)"
            className="inline-flex items-center gap-1.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
            {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            ) : (
                <FileDown className="w-4 h-4" aria-hidden />
            )}
            {generating ? 'Generating…' : 'Export PDF'}
        </button>
    )
}

export default ExportPDF
