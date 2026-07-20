// Dinamik import i `xlsx` — paketa është ~140 KB gzip dhe përdoret vetëm te
// import/export/template. Duke e ngarkuar këtu, bundle-i inicial nuk e ka
// fare; kostoja paguhet vetëm kur user shtyp butonin përkatës.
export async function loadXLSX() {
  return await import('xlsx')
}
