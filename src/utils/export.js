import { loadXLSX } from '../lib/xlsx.js'

export async function exportToExcel(filename, rows, opts = {}) {
  const { sheetName = 'Raporti', columnWidths } = opts
  const XLSX = await loadXLSX()
  const ws = XLSX.utils.json_to_sheet(rows)
  if (columnWidths) ws['!cols'] = columnWidths.map(w => ({ wch: w }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Open a print window with formatted HTML — user picks "Save as PDF" in print dialog.
export function exportToPdf(title, sections) {
  // sections: [{ title?, subtitle?, headers: [...], rows: [[...], ...], footerRows?: [[...]] }]
  const sectionsHtml = sections.map(sec => {
    const headersHtml = sec.headers
      ? `<tr>${sec.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`
      : ''
    const rowsHtml = (sec.rows || []).map(row =>
      `<tr>${row.map(cell => {
        if (typeof cell === 'object' && cell !== null) {
          return `<td class="${cell.cls || ''}">${escapeHtml(cell.v)}</td>`
        }
        return `<td>${escapeHtml(cell)}</td>`
      }).join('')}</tr>`
    ).join('')
    const footerHtml = (sec.footerRows || []).map(row =>
      `<tr class="total">${row.map(cell => {
        if (typeof cell === 'object' && cell !== null) {
          return `<td class="${cell.cls || ''}">${escapeHtml(cell.v)}</td>`
        }
        return `<td>${escapeHtml(cell)}</td>`
      }).join('')}</tr>`
    ).join('')
    return `
      ${sec.title ? `<h2>${escapeHtml(sec.title)}</h2>` : ''}
      ${sec.subtitle ? `<p class="subtitle">${escapeHtml(sec.subtitle)}</p>` : ''}
      <table>
        <thead>${headersHtml}</thead>
        <tbody>${rowsHtml}</tbody>
        ${footerHtml ? `<tfoot>${footerHtml}</tfoot>` : ''}
      </table>
    `
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; padding: 24px; color: #1e293b; }
    h1 { font-size: 20px; color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin: 0 0 4px; }
    h2 { font-size: 14px; color: #334155; margin: 18px 0 4px; }
    .subtitle { color: #64748b; font-size: 11px; margin: 0 0 8px; }
    .header-meta { color: #64748b; font-size: 11px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 11px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 700; text-transform: uppercase; font-size: 10px; color: #475569; }
    tr.total td { background: #fef3c7; font-weight: 700; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .center { text-align: center; }
    .red { color: #b91c1c; font-weight: 600; }
    .green { color: #047857; font-weight: 600; }
    .footer { margin-top: 30px; padding-top: 8px; border-top: 1px solid #cbd5e1; color: #94a3b8; font-size: 10px; text-align: center; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="header-meta">Gjeneruar: ${new Date().toLocaleString('sq-AL')} · Cham Shop — Sistem Inventari</div>
  ${sectionsHtml}
  <div class="footer">— Fund i Raportit —</div>
  <script>
    window.onload = function() { setTimeout(function() { window.print() }, 250) }
  </script>
</body>
</html>`

  const w = window.open('', '_blank', 'width=1000,height=800')
  if (!w) { alert('Lejo dritaret pop-up për të printuar PDF.'); return }
  w.document.open()
  w.document.write(html)
  w.document.close()
}

export function formatNum(v) {
  const n = parseFloat(v) || 0
  return n.toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
