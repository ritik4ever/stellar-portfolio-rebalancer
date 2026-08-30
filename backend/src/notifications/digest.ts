import { createHmac } from 'node:crypto'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { databaseService } from '../services/databaseService.js'
import { notificationService } from '../services/notificationService.js'
import { ReflectorService } from '../services/reflector.js'
import { analyticsService } from '../services/analyticsService.js'
import { dbGetAllNotificationPreferences, type NotificationPreferences } from '../db/notificationDb.js'
import { logger } from '../utils/logger.js'
import type { Portfolio } from '../types/index.js'

export type DigestFrequency = 'daily' | 'weekly' | 'monthly'

interface AssetPerformance {
  asset: string
  valueChange: number
  currentValue: number
}

interface PortfolioDigestData {
  portfolioId: string
  portfolioName: string
  totalValue: number
  percentChange: number
  rebalanceCount: number
  topPerformer: { asset: string; change: number } | null
  worstPerformer: { asset: string; change: number } | null
}

interface UserDigestData {
  userId: string
  emailAddress: string
  portfolios: PortfolioDigestData[]
  totalValue: number
  overallChange: number
  totalRebalances: number
  period: string
  periodStart: string
  periodEnd: string
}

const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || process.env.SMTP_PASS || 'stellar-unsubscribe-key'

export async function sendDigests(frequency: DigestFrequency): Promise<void> {
  const allPrefs = dbGetAllNotificationPreferences()
  const eligible = allPrefs.filter(
    p => p.emailEnabled && p.emailAddress && p.digestMode === frequency
  )

  if (eligible.length === 0) return

  const reflector = new ReflectorService()
  const prices = await reflector.getCurrentPrices()

  for (const prefs of eligible) {
    try {
      await sendUserDigest(prefs, frequency, prices)
    } catch (error) {
      logger.error('Failed to send portfolio digest', {
        userId: prefs.userId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

async function sendUserDigest(
  prefs: NotificationPreferences,
  frequency: DigestFrequency,
  prices: Record<string, { price: number; change: number }>,
): Promise<void> {
  const userId = prefs.userId
  const emailAddress = prefs.emailAddress!
  const portfolios = portfolioStorage.getUserPortfolios(userId)
  if (portfolios.length === 0) return

  const now = new Date()
  const periodStart = new Date(now)
  const daysMap: Record<DigestFrequency, number> = { daily: 1, weekly: 7, monthly: 30 }
  periodStart.setDate(periodStart.getDate() - daysMap[frequency])

  let totalCurrentValue = 0
  let totalStartValue = 0
  let totalRebalances = 0
  const portfolioData: PortfolioDigestData[] = []

  for (const portfolio of portfolios) {
    const currentValue = computePortfolioCurrentValue(portfolio, prices)
    totalCurrentValue += currentValue

    const startValue = estimatePortfolioStartValue(portfolio, prices, periodStart)
    totalStartValue += startValue

    const percentChange = startValue > 0 ? ((currentValue - startValue) / startValue) * 100 : 0

    const rebalances = databaseService.getAutoRebalancesSince(portfolio.id, periodStart)
    totalRebalances += rebalances.length

    const perfs = computeAssetPerformances(portfolio, prices, periodStart)

    portfolioData.push({
      portfolioId: portfolio.id,
      portfolioName: portfolio.name || portfolio.id,
      totalValue: currentValue,
      percentChange,
      rebalanceCount: rebalances.length,
      topPerformer: findTopPerformer(perfs),
      worstPerformer: findWorstPerformer(perfs),
    })
  }

  const overallChange = totalStartValue > 0
    ? ((totalCurrentValue - totalStartValue) / totalStartValue) * 100
    : 0

  const digestData: UserDigestData = {
    userId,
    emailAddress,
    portfolios: portfolioData,
    totalValue: totalCurrentValue,
    overallChange,
    totalRebalances,
    period: formatPeriod(frequency),
    periodStart: formatDate(periodStart),
    periodEnd: formatDate(now),
  }

  const unsubscribeToken = createUnsubscribeToken(userId)
  const baseUrl = process.env.API_URL || process.env.APP_URL || 'https://api.stellarportfolio.com'
  const unsubscribeUrl = `${baseUrl}/api/notifications/unsubscribe?token=${unsubscribeToken}&userId=${encodeURIComponent(userId)}`

  const html = generateDigestHtml(digestData, unsubscribeUrl)
  const text = generateDigestText(digestData, unsubscribeUrl)

  await notificationService.sendRawEmail({
    to: emailAddress,
    subject: `[Stellar Portfolio] ${capitalize(frequency)} Portfolio Summary`,
    html,
    text,
  })
}

function computePortfolioCurrentValue(portfolio: Portfolio, prices: Record<string, { price: number }>): number {
  let total = 0
  for (const [asset, balance] of Object.entries(portfolio.balances)) {
    const price = prices[asset]?.price || 0
    total += Number(balance) * price
  }
  return total
}

function estimatePortfolioStartValue(
  portfolio: Portfolio,
  prices: Record<string, { price: number; change: number }>,
  periodStart: Date,
): number {
  const snapshots = analyticsService.getAnalyticsInRange(
    portfolio.id,
    periodStart.toISOString(),
    new Date().toISOString(),
  )

  if (snapshots.length > 0) {
    return snapshots[0].totalValue
  }

  let total = 0
  for (const [asset, balance] of Object.entries(portfolio.balances)) {
    const priceData = prices[asset]
    if (!priceData) continue
    const currentPrice = priceData.price
    const changePct = priceData.change
    const startPrice = changePct !== 0 ? currentPrice / (1 + changePct / 100) : currentPrice
    total += Number(balance) * startPrice
  }
  return total
}

function computeAssetPerformances(
  portfolio: Portfolio,
  prices: Record<string, { price: number; change: number }>,
  periodStart: Date,
): AssetPerformance[] {
  const results: AssetPerformance[] = []

  for (const [asset, balance] of Object.entries(portfolio.balances)) {
    const priceData = prices[asset]
    if (!priceData) continue
    const currentPrice = priceData.price
    const currentValue = Number(balance) * currentPrice
    const changePct = priceData.change
    const startPrice = changePct !== 0 ? currentPrice / (1 + changePct / 100) : currentPrice
    const startValue = Number(balance) * startPrice
    const valueChange = startValue > 0 ? ((currentValue - startValue) / startValue) * 100 : 0

    results.push({ asset, valueChange, currentValue })
  }

  results.sort((a, b) => b.valueChange - a.valueChange)
  return results
}

function findTopPerformer(perfs: AssetPerformance[]): { asset: string; change: number } | null {
  if (perfs.length === 0) return null
  return { asset: perfs[0].asset, change: perfs[0].valueChange }
}

function findWorstPerformer(perfs: AssetPerformance[]): { asset: string; change: number } | null {
  if (perfs.length === 0) return null
  const worst = perfs[perfs.length - 1]
  return { asset: worst.asset, change: worst.valueChange }
}

function createUnsubscribeToken(userId: string): string {
  return createHmac('sha256', UNSUBSCRIBE_SECRET)
    .update(userId)
    .digest('hex')
}

function formatPeriod(frequency: DigestFrequency): string {
  const labels: Record<DigestFrequency, string> = {
    daily: 'Today',
    weekly: 'This Week',
    monthly: 'This Month',
  }
  return labels[frequency]
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function changeColor(value: number): string {
  return value >= 0 ? '#22c55e' : '#ef4444'
}

function generatePerformanceChartSvg(
  portfolios: PortfolioDigestData[],
  overallChange: number,
): string {
  const width = 520
  const height = 80 + portfolios.length * 40
  const barX = 160
  const barWidth = 280
  const barH = 18
  const labelX = 10
  const valueX = 450

  const maxAbs = Math.max(
    1,
    ...portfolios.map(p => Math.abs(p.percentChange)),
    Math.abs(overallChange),
  )

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  svg += `<rect width="${width}" height="${height}" fill="none"/>`

  const drawBar = (y: number, label: string, pct: number, color: string) => {
    const absPct = Math.abs(pct)
    const fillWidth = Math.round((absPct / maxAbs) * barWidth)
    svg += `<text x="${labelX}" y="${y + 14}" font-family="Arial,sans-serif" font-size="13" fill="#374151">${label}</text>`
    svg += `<rect x="${barX}" y="${y}" width="${barWidth}" height="${barH}" rx="4" fill="#f3f4f6"/>`
    if (fillWidth > 0) {
      svg += `<rect x="${barX}" y="${y}" width="${fillWidth}" height="${barH}" rx="4" fill="${color}"/>`
    }
    svg += `<text x="${valueX}" y="${y + 14}" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="${color}">${formatPercent(pct)}</text>`
  }

  drawBar(10, 'Overall Portfolio', overallChange, changeColor(overallChange))

  let yOffset = 50
  for (const p of portfolios) {
    drawBar(yOffset, truncateLabel(p.portfolioName, 18), p.percentChange, changeColor(p.percentChange))
    yOffset += 40
  }

  svg += '</svg>'
  return svg
}

function generatePerformerChartSvg(
  top: { asset: string; change: number } | null,
  worst: { asset: string; change: number } | null,
): string {
  const width = 520
  const height = 90
  const barX = 160
  const barWidth = 280
  const barH = 18
  const labelX = 10
  const valueX = 450

  const items: Array<{ label: string; pct: number; color: string }> = []
  if (top) items.push({ label: `Best: ${top.asset}`, pct: top.change, color: changeColor(top.change) })
  if (worst) items.push({ label: `Worst: ${worst.asset}`, pct: worst.change, color: changeColor(worst.change) })

  const maxAbs = Math.max(1, ...items.map(i => Math.abs(i.pct)))

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  svg += `<rect width="${width}" height="${height}" fill="none"/>`

  let yOffset = 10
  for (const item of items) {
    const absPct = Math.abs(item.pct)
    const fillWidth = Math.round((absPct / maxAbs) * barWidth)
    svg += `<text x="${labelX}" y="${yOffset + 14}" font-family="Arial,sans-serif" font-size="13" fill="#374151">${item.label}</text>`
    svg += `<rect x="${barX}" y="${yOffset}" width="${barWidth}" height="${barH}" rx="4" fill="#f3f4f6"/>`
    if (fillWidth > 0) {
      svg += `<rect x="${barX}" y="${yOffset}" width="${fillWidth}" height="${barH}" rx="4" fill="${item.color}"/>`
    }
    svg += `<text x="${valueX}" y="${yOffset + 14}" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="${item.color}">${formatPercent(item.pct)}</text>`
    yOffset += 40
  }

  svg += '</svg>'
  return svg
}

function svgToDataUri(svg: string): string {
  const base64 = Buffer.from(svg, 'utf-8').toString('base64')
  return `data:image/svg+xml;base64,${base64}`
}

function truncateLabel(label: string, maxLen: number): string {
  return label.length > maxLen ? label.slice(0, maxLen - 1) + '…' : label
}

function generateDigestHtml(data: UserDigestData, unsubscribeUrl: string): string {
  const perfChartSvg = generatePerformanceChartSvg(data.portfolios, data.overallChange)
  const perfChartImg = svgToDataUri(perfChartSvg)

  let performerChartImg = ''
  if (data.portfolios.length === 1) {
    const p = data.portfolios[0]
    const performerSvg = generatePerformerChartSvg(p.topPerformer, p.worstPerformer)
    performerChartImg = svgToDataUri(performerSvg)
  }

  const portfolioRows = data.portfolios.map(p => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151">${escapeHtml(p.portfolioName)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;text-align:right">${formatCurrency(p.totalValue)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:right;color:${changeColor(p.percentChange)}">${formatPercent(p.percentChange)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;text-align:center">${p.rebalanceCount}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#22c55e">${p.topPerformer ? `${p.topPerformer.asset} (${formatPercent(p.topPerformer.change)})` : '—'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#ef4444">${p.worstPerformer ? `${p.worstPerformer.asset} (${formatPercent(p.worstPerformer.change)})` : '—'}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Portfolio Summary</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:20px 0">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

<tr>
<td style="background:linear-gradient(135deg,#3B82F6,#1d4ed8);padding:30px 24px;text-align:center">
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700">${capitalize(data.period)} Portfolio Summary</h1>
<p style="margin:8px 0 0;color:#bfdbfe;font-size:14px">${data.periodStart} – ${data.periodEnd}</p>
</td>
</tr>

<tr>
<td style="padding:24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td width="50%" style="padding:16px;text-align:center;background:#f8fafc;border-radius:8px">
<p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Total Value</p>
<p style="margin:8px 0 0;font-size:28px;font-weight:700;color:#111827">${formatCurrency(data.totalValue)}</p>
</td>
<td width="50%" style="padding:16px;text-align:center;background:#f8fafc;border-radius:8px">
<p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Change</p>
<p style="margin:8px 0 0;font-size:28px;font-weight:700;color:${changeColor(data.overallChange)}">${formatPercent(data.overallChange)}</p>
</td>
</tr>
</table>
</td>
</tr>

${data.portfolios.length > 1 ? `
<tr>
<td style="padding:0 24px">
<img src="${perfChartImg}" alt="Portfolio Performance Chart" width="520" height="${120 + data.portfolios.length * 40}" style="display:block;max-width:100%;height:auto">
</td>
</tr>
` : ''}

<tr>
<td style="padding:24px">
<h2 style="margin:0 0 16px;font-size:16px;color:#111827">Portfolio Breakdown</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<thead>
<tr style="background:#f9fafb">
<th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;text-align:left">Portfolio</th>
<th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;text-align:right">Value</th>
<th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;text-align:right">Change</th>
<th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;text-align:center">Rebalances</th>
<th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;text-align:left">Best</th>
<th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;text-align:left">Worst</th>
</tr>
</thead>
<tbody>
${portfolioRows}
</tbody>
</table>
</td>
</tr>

${data.portfolios.length === 1 && performerChartImg ? `
<tr>
<td style="padding:0 24px 24px">
<img src="${performerChartImg}" alt="Asset Performance Chart" width="520" height="90" style="display:block;max-width:100%;height:auto">
</td>
</tr>
` : ''}

<tr>
<td style="padding:24px;background:#f9fafb;border-top:1px solid #e5e7eb">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td width="50%" style="padding:8px;text-align:center">
<p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Rebalances</p>
<p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#111827">${data.totalRebalances}</p>
</td>
<td width="50%" style="padding:8px;text-align:center">
<p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Portfolios Tracked</p>
<p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#111827">${data.portfolios.length}</p>
</td>
</tr>
</table>
</td>
</tr>

<tr>
<td style="padding:24px;text-align:center;font-size:12px;color:#9ca3af">
<p style="margin:0 0 8px">Stellar Portfolio Rebalancer</p>
<p style="margin:0 0 4px">This is an automated ${data.period.toLowerCase()} summary of your portfolio performance.</p>
<a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline">Unsubscribe from digest emails</a>
</td>
</tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

function generateDigestText(data: UserDigestData, unsubscribeUrl: string): string {
  const lines: string[] = [
    `${capitalize(data.period)} Portfolio Summary`,
    `${data.periodStart} – ${data.periodEnd}`,
    '',
    `Total Value: ${formatCurrency(data.totalValue)}`,
    `Change: ${formatPercent(data.overallChange)}`,
    `Rebalances: ${data.totalRebalances}`,
    `Portfolios Tracked: ${data.portfolios.length}`,
    '',
  ]

  for (const p of data.portfolios) {
    lines.push(`--- ${p.portfolioName} ---`)
    lines.push(`  Value: ${formatCurrency(p.totalValue)}`)
    lines.push(`  Change: ${formatPercent(p.percentChange)}`)
    lines.push(`  Rebalances: ${p.rebalanceCount}`)
    if (p.topPerformer) lines.push(`  Best: ${p.topPerformer.asset} (${formatPercent(p.topPerformer.change)})`)
    if (p.worstPerformer) lines.push(`  Worst: ${p.worstPerformer.asset} (${formatPercent(p.worstPerformer.change)})`)
    lines.push('')
  }

  lines.push('---')
  lines.push('Stellar Portfolio Rebalancer')
  lines.push('')
  lines.push(`Unsubscribe: ${unsubscribeUrl}`)

  return lines.join('\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
