// Gjenerim + printim barkodi Code128 për etiketa termike.
//
// Format i barkodit: "GS-XXXXXXXX" (prefiks Gold Shop + 8 karaktere random).
// Alfabet pa 0/O dhe 1/I për të shmangur ngatërrimet vizuale.
//
// jsbarcode (~72KB) ngarkohet dinamikisht vetëm kur user shtyp Printo — që
// të mos rëndojë bundle-in për userat që s'e përdorin këtë veçori.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateBarcode() {
  let s = 'GS-'
  for (let i = 0; i < 8; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return s
}

// Render Code128 si SVG string i gatshëm për të futur në HTML.
// Përmasat janë optimizuar për etiketat butterfly bizhuteri (zona qendrore
// ~30mm × 11mm e dukshme pas mbështjelljes).
function renderBarcodeSVG(JsBarcode, text) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, text, {
    format: 'CODE128',
    width: 1.1,
    height: 28,
    displayValue: true,
    fontSize: 8,
    margin: 1,
    textMargin: 0,
  })
  const wrap = document.createElement('div')
  wrap.appendChild(svg)
  return wrap.innerHTML
}

// Printo një ose disa etiketa. Çdo etiketë zë një faqe të printer-it termik
// Zebra ZD220 — etiketa butterfly bizhuteri 70mm × 15mm (totali). Përmbajtja
// (barkodi + çmimi) qendrohet në pjesën e ngushtë ~30mm × 11mm që mbetet e
// dukshme kur etiketa mbështillet rreth artikullit. items: [{ barcode, sell_price }]
export async function printLabels(items) {
  const usable = items.filter(it => it.barcode && String(it.barcode).trim())
  if (usable.length === 0) {
    alert('Asnjë barkod për printim. Gjenero ose zgjidh një produkt me barkod.')
    return
  }

  // Ngarko jsbarcode vetëm tani (~72KB gzip) — jo në bundle-in kryesor.
  const { default: JsBarcode } = await import('jsbarcode')

  const labels = usable.map(it => {
    const svg = renderBarcodeSVG(JsBarcode, String(it.barcode).trim())
    const price = (parseFloat(it.sell_price) || 0).toLocaleString('sq-AL', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    })
    return `<div class="label"><div class="inner">${svg}<div class="price">€ ${price}</div></div></div>`
  }).join('')

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Etiketa</title>
<style>
  @page { size: 70mm 15mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .label {
    width: 70mm; height: 15mm;
    display: flex; align-items: center; justify-content: center;
    box-sizing: border-box;
    page-break-after: always;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .label:last-child { page-break-after: auto; }
  /* Zona qendrore e dukshme — pjesa tjetër (krahët) mbështillet prapa */
  .inner {
    width: 30mm; height: 13mm;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .inner svg { max-width: 100%; max-height: 9mm; }
  .price { font-weight: 700; font-size: 6pt; margin-top: 0.3mm; letter-spacing: 0.2px; line-height: 1; }
</style></head><body>${labels}</body></html>`

  // Iframe i fshehur në vend të window.open() — kjo e fundit bllokohet si popup
  // nga Windows (Edge/Chrome) edhe në app-in Electron.
  const frame = document.createElement('iframe')
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(frame)
  const doc = frame.contentDocument || frame.contentWindow.document
  doc.open(); doc.write(html); doc.close()
  setTimeout(() => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } catch (e) { console.error(e) }
    setTimeout(() => { try { document.body.removeChild(frame) } catch { /* ignore */ } }, 1000)
  }, 250)
}
