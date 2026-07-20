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
function renderBarcodeSVG(JsBarcode, text) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, text, {
    format: 'CODE128',
    width: 1.6,
    height: 45,
    displayValue: true,
    fontSize: 11,
    margin: 2,
    textMargin: 1,
  })
  const wrap = document.createElement('div')
  wrap.appendChild(svg)
  return wrap.innerHTML
}

// Printo një ose disa etiketa. Çdo etiketë zë një faqe të printer-it termik
// (50×30mm). items: [{ barcode, sell_price }]
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
    return `<div class="label">${svg}<div class="price">€ ${price}</div></div>`
  }).join('')

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Etiketa</title>
<style>
  @page { size: 50mm 30mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .label {
    width: 50mm; height: 30mm;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    box-sizing: border-box; padding: 1mm;
    page-break-after: always;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .label:last-child { page-break-after: auto; }
  .label svg { max-width: 100%; }
  .price { font-weight: 700; font-size: 12pt; margin-top: 1mm; letter-spacing: 0.3px; }
  @media screen {
    body { background: #eee; padding: 12px; }
    .label { background: #fff; margin: 8px auto; border: 1px solid #ccc; }
  }
</style></head><body>${labels}
<script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body></html>`

  const w = window.open('', '_blank', 'width=420,height=520')
  if (!w) {
    alert('Bllokuesi i popup-eve e ndaloi dritaren e printimit. Lejo popup-in për këtë faqe dhe provo përsëri.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}
