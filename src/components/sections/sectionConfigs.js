// Per-sub-page configurations mapped to slices of /api/daily/{date}.

export const SECTION_CONFIGS = {
  // ── Arka ──
  'arka-shpenzime': {
    title: 'Shpenzime',
    description: 'Shpenzime ditore të paguara nga arka.',
    rows: [{ label: 'Shpenzime', fields: { lek: 'expenses_lek', eur: 'expenses_eur', usd: 'expenses_usd' } }],
  },
  'arka-konv-valute': {
    title: 'Konvertim Valute',
    description: 'Konvertim mes monedhave brenda arkës.',
    rows: [{ label: 'Konvertim', fields: { lek: 'conv_lek', eur: 'conv_eur', usd: 'conv_usd', gbp: 'conv_gbp', chf: 'conv_chf' } }],
  },
  'arka-konv-hurda': {
    title: 'Konvertim Hurda',
    description: 'Konvertim i hurdës në vlera monetare.',
    rows: [{ label: 'Hurda', fields: { lek: 'hurda_lek', eur: 'hurda_eur', usd: 'hurda_usd', gbp: 'hurda_gbp', chf: 'hurda_chf', gram: 'hurda_gram' } }],
  },
  'arka-kasaforta': {
    title: 'Gjendje Kasaforta',
    description: 'Gjendja e mbartur në kasafortë në fillim të ditës.',
    rows: [
      { label: 'Gjendje fillestare', fields: { lek: 'opening_lek', eur: 'opening_eur', usd: 'opening_usd', gbp: 'opening_gbp', chf: 'opening_chf' } },
    ],
  },

  // ── Banka ──
  'banka-terheqje': {
    title: 'Tërheqje nga Banka',
    description: 'Para të tërhequra nga banka për nevoja të dyqanit.',
    rows: [{ label: 'Tërheqje', fields: { lek: 'bank_withdraw_lek', eur: 'bank_withdraw_eur', usd: 'bank_withdraw_usd' } }],
  },
  'banka-depozitim': {
    title: 'Depozitim në Bankë',
    description: 'Para të depozituara në llogari bankare.',
    rows: [{ label: 'Depozitim', fields: { lek: 'bank_deposit_lek', eur: 'bank_deposit_eur', usd: 'bank_deposit_usd' } }],
  },

  // ── BNJ ──
  'bnj-biba': {
    title: 'Tërheqje BIBA',
    description: 'Tërheqje personale e administratores BIBA.',
    rows: [{ label: 'BIBA', fields: { lek: 'biba_lek', eur: 'biba_eur', usd: 'biba_usd', gbp: 'biba_gbp', chf: 'biba_chf', gram: 'biba_gram' } }],
  },
  'bnj-diana': {
    title: 'Tërheqje DIANA',
    description: 'Tërheqje personale e administratores DIANA.',
    rows: [{ label: 'DIANA', fields: { lek: 'diana_lek', eur: 'diana_eur', usd: 'diana_usd', gbp: 'diana_gbp', chf: 'diana_chf', hurda: 'diana_hurda' } }],
  },

  // ── Blerje ──
  'shlyerje-borxhi': {
    title: 'Shlyerje Borxhi te Produkteve',
    description: 'Pagesa drejt furnitorëve për mallrat e marra.',
    rows: [{ label: 'Shlyerje', fields: { eur: 'debt_settlement_eur', usd: 'debt_settlement_usd', gbp: 'debt_settlement_gbp', chf: 'debt_settlement_chf', has: 'debt_settlement_has' } }],
  },

  // ── Celje ──
  'celje-mbartur': {
    title: 'Gjendje e Mbartur',
    description: 'Gjendja e arkës e mbartur nga dita paraardhëse.',
    rows: [
      { label: 'Gjendje e mbartur', fields: { lek: 'opening_lek', eur: 'opening_eur', usd: 'opening_usd', gbp: 'opening_gbp', chf: 'opening_chf' } },
    ],
  },
  'celje-dites': {
    title: 'Celja e Ditës',
    description: 'Gjendja fillestare e arkës për këtë ditë.',
    rows: [
      { label: 'Celja', fields: { lek: 'opening_lek', eur: 'opening_eur', usd: 'opening_usd', gbp: 'opening_gbp', chf: 'opening_chf' } },
    ],
  },
}
