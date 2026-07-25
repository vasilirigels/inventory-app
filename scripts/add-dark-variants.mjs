#!/usr/bin/env node
// Shton variante `dark:` te klasat Tailwind hardcoded në komponentët e UI-së.
// Përdorim: node scripts/add-dark-variants.mjs
//
// Rregullat aplikohen si zëvendësime teksti. Për të shmangur duplikime kur një
// klasë tashmë ka variantin dark: pranë saj, kërkojmë me negative-lookahead
// brenda të njëjtit string të className-it.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', 'src')

const FILES = [
  'App.jsx',
  'components/AnalizeVeprime.jsx',
  'components/AnalizeVeprimeFurnitor.jsx',
  'components/ArkaDitore.jsx',
  'components/AuthGate.jsx',
  'components/AuthLogin.jsx',
  'components/AuthSetup.jsx',
  'components/BlerjeHas.jsx',
  'components/CashRegister.jsx',
  'components/CommentToast.jsx',
  'components/Customers.jsx',
  'components/CustomersLedger.jsx',
  'components/Dashboard.jsx',
  'components/DateRangeFilter.jsx',
  'components/DetyrimetFurnitor.jsx',
  'components/DetyrimetKlienti.jsx',
  'components/FaturaBlerje.jsx',
  'components/FaturaShitje.jsx',
  'components/Flete.jsx',
  'components/Furnitor.jsx',
  'components/InventarPermbledhese.jsx',
  'components/Kasaforta.jsx',
  'components/Klienti.jsx',
  'components/Komentet.jsx',
  'components/KonvertimHurda.jsx',
  'components/LevizjeBanke.jsx',
  'components/Magazina.jsx',
  'components/Magazinat.jsx',
  'components/Marketing.jsx',
  'components/PeriodPicker.jsx',
  'components/Products.jsx',
  'components/ProduktePromocion.jsx',
  'components/RaportBlerjeArtikuj.jsx',
  'components/RaportShitjeArtikuj.jsx',
  'components/RaportShpenzime.jsx',
  'components/Riparimet.jsx',
  'components/SalesSection.jsx',
  'components/Shpenzime.jsx',
  'components/TerheqjaKasaforta.jsx',
  'components/sections/DailyFieldsForm.jsx',
  'components/sections/InventoryFlow.jsx',
  'components/sections/MonthlyReport.jsx',
  'components/sections/UnifiedReport.jsx',
  'components/sections/YearlyReport.jsx',
]

// Radha ka rëndësi: klasat më specifike (me prefix hover:/focus:) shkojnë të parat.
const RULES = [
  // hover: variantet (backgrounds)
  ['hover:bg-white',       'dark:hover:bg-slate-800'],
  ['hover:bg-slate-50',    'dark:hover:bg-slate-800/50'],
  ['hover:bg-slate-100',   'dark:hover:bg-slate-800'],
  ['hover:bg-slate-200',   'dark:hover:bg-slate-700'],
  ['hover:bg-slate-300',   'dark:hover:bg-slate-600'],
  // hover: variantet (text)
  ['hover:text-slate-900', 'dark:hover:text-white'],
  ['hover:text-slate-800', 'dark:hover:text-slate-100'],
  ['hover:text-slate-700', 'dark:hover:text-slate-200'],
  ['hover:text-slate-600', 'dark:hover:text-slate-300'],

  // Backgrounds bazë
  ['bg-white',       'dark:bg-slate-800'],
  ['bg-slate-50',    'dark:bg-slate-900'],
  ['bg-slate-100',   'dark:bg-slate-800'],
  ['bg-slate-200',   'dark:bg-slate-700'],
  ['bg-slate-300',   'dark:bg-slate-600'],
  ['bg-slate-800',   'dark:bg-slate-900'],
  ['bg-slate-900',   'dark:bg-slate-950'],

  // Tekst bazë
  ['text-slate-900', 'dark:text-white'],
  ['text-slate-800', 'dark:text-slate-100'],
  ['text-slate-700', 'dark:text-slate-200'],
  ['text-slate-600', 'dark:text-slate-300'],
  ['text-slate-500', 'dark:text-slate-400'],
  ['text-slate-400', 'dark:text-slate-500'],

  // Borde (të gjitha anët)
  ['border-slate-100', 'dark:border-slate-800'],
  ['border-slate-200', 'dark:border-slate-700'],
  ['border-slate-300', 'dark:border-slate-700'],
  ['border-t-slate-100', 'dark:border-t-slate-800'],
  ['border-t-slate-200', 'dark:border-t-slate-700'],
  ['border-b-slate-100', 'dark:border-b-slate-800'],
  ['border-b-slate-200', 'dark:border-b-slate-700'],
  ['border-l-slate-100', 'dark:border-l-slate-800'],
  ['border-l-slate-200', 'dark:border-l-slate-700'],
  ['border-r-slate-100', 'dark:border-r-slate-800'],
  ['border-r-slate-200', 'dark:border-r-slate-700'],

  // divide-*
  ['divide-slate-100', 'dark:divide-slate-800'],
  ['divide-slate-200', 'dark:divide-slate-700'],

  // Ngjyra semantike (sfonde të lehta)
  ['bg-blue-50',    'dark:bg-blue-900/30'],
  ['bg-emerald-50', 'dark:bg-emerald-900/30'],
  ['bg-green-50',   'dark:bg-green-900/30'],
  ['bg-red-50',     'dark:bg-red-900/30'],
  ['bg-amber-50',   'dark:bg-amber-900/30'],
  ['bg-yellow-50',  'dark:bg-yellow-900/30'],
  ['bg-purple-50',  'dark:bg-purple-900/30'],
  ['bg-orange-50',  'dark:bg-orange-900/30'],
  ['bg-pink-50',    'dark:bg-pink-900/30'],
  ['bg-indigo-50',  'dark:bg-indigo-900/30'],

  // Ngjyra semantike (tekst i errët në light)
  ['text-blue-700',    'dark:text-blue-300'],
  ['text-blue-800',    'dark:text-blue-200'],
  ['text-emerald-700', 'dark:text-emerald-300'],
  ['text-emerald-800', 'dark:text-emerald-200'],
  ['text-green-700',   'dark:text-green-300'],
  ['text-green-800',   'dark:text-green-200'],
  ['text-red-700',     'dark:text-red-300'],
  ['text-red-800',     'dark:text-red-200'],
  ['text-amber-700',   'dark:text-amber-300'],
  ['text-amber-800',   'dark:text-amber-200'],
  ['text-yellow-700',  'dark:text-yellow-300'],
  ['text-yellow-800',  'dark:text-yellow-200'],
  ['text-purple-700',  'dark:text-purple-300'],
  ['text-purple-800',  'dark:text-purple-200'],
  ['text-orange-700',  'dark:text-orange-300'],
  ['text-orange-800',  'dark:text-orange-200'],

  // Placeholder
  ['placeholder-slate-400', 'dark:placeholder-slate-500'],
  ['placeholder-slate-500', 'dark:placeholder-slate-500'],

  // Ring / focus
  ['ring-slate-200', 'dark:ring-slate-700'],
  ['ring-white',     'dark:ring-slate-900'],
]

// Përditëson një string className: shton `darkClass` menjëherë pas token-it të
// dhënë, por vetëm nëse `darkClass` nuk ndodhet tashmë brenda po të njëjtit
// string të className-it.
function addDarkAfterToken(source, token, darkClass) {
  // Match: fjala e saktë e token-it, e paraprirë nga fillim-string ose whitespace,
  // pasuar nga fund-string ose whitespace. Përdorim regex me lookarounds që
  // funksionojnë me karaktere si `:` dhe `-` në klasa Tailwind.
  const escaped = token.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\w:\\-/])${escaped}(?![\\w:\\-/])`, 'g')
  // Për të mos duplikuar, do të bëjmë një pass të thjeshtë: shtojmë darkClass
  // pas çdo ndodhjeje. Në fund të skriptit bëjmë dedupe të klasave brenda
  // atributit className.
  return source.replace(pattern, `${token} ${darkClass}`)
}

// Dedupe: brenda çdo string-i literal (të thjeshtë ose brenda backticks të
// thjeshtë pa expressions), heq klasat e përsëritura duke ruajtur radhën e
// parë të shfaqjes. Puno vetëm nëse stringu duket si listë klasash.
function dedupeClassStrings(source) {
  const stringPattern = /(["'`])((?:(?=(\\?))\3.)*?)\1/g
  return source.replace(stringPattern, (whole, quote, body) => {
    // Heuristik i thjeshtë: vetëm nëse trupi duket si klasa Tailwind
    // (whitespace + tokena me shkronja/numra/kufizues), i deduplicojmë.
    if (!/^[\s\w:\-/\[\]().,%#]+$/.test(body)) return whole
    // Ndaje sipas whitespace, mbaji radhën e parë të shfaqjes.
    const parts = body.split(/(\s+)/)
    const seen = new Set()
    const out = []
    for (const p of parts) {
      if (/^\s+$/.test(p)) { out.push(p); continue }
      if (!p) { out.push(p); continue }
      if (seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
    return `${quote}${out.join('')}${quote}`
  })
}

async function main() {
  let totalChanged = 0
  for (const rel of FILES) {
    const path = join(ROOT, rel)
    let src
    try { src = await readFile(path, 'utf8') } catch (e) {
      console.error(`skip ${rel}: ${e.message}`); continue
    }
    const before = src
    for (const [token, darkClass] of RULES) {
      src = addDarkAfterToken(src, token, darkClass)
    }
    src = dedupeClassStrings(src)
    if (src !== before) {
      await writeFile(path, src, 'utf8')
      console.log(`updated ${rel}`)
      totalChanged++
    } else {
      console.log(`unchanged ${rel}`)
    }
  }
  console.log(`\nDone. ${totalChanged} files changed.`)
}

main().catch(err => { console.error(err); process.exit(1) })
