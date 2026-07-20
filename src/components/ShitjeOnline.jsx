import FaturaShitje from './FaturaShitje.jsx'

// Shitje Online = FaturaShitje me flag-un `online=true`. Përdor të njëjtat
// tabela + endpoint-e (invoices, invoice_items, invoice_payment_splits) por:
//  - filtron listën për is_online=1
//  - shfaq tabs statusi porosie + butona quick-status
//  - shton fushat kanali / adresa / tracking / statusi te editori
//  - kërkon POST-in me is_online=1
export default function ShitjeOnline(props) {
  return <FaturaShitje {...props} online />
}
