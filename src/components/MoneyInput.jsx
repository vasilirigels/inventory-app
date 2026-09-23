import { useState, useEffect, useRef } from 'react'

function digitsToDisplay(digits) {
  const raw = String(digits || '').replace(/\D/g, '')
  const padded = raw.padStart(3, '0')
  const intPart = padded.slice(0, -2)
  const decPart = padded.slice(-2)
  const intClean = String(parseInt(intPart, 10) || 0)
  return `${intClean}.${decPart}`
}

function valueToDigits(v) {
  const n = parseFloat(v)
  if (!Number.isFinite(n) || n === 0) return ''
  const cents = Math.round(Math.abs(n) * 100)
  return String(cents)
}

export default function MoneyInput({ value, onChange, allowNegative = false, className = '', disabled, placeholder, ...rest }) {
  const [digits, setDigits] = useState(() => valueToDigits(value))
  const [isNegative, setIsNegative] = useState(() => allowNegative && (parseFloat(value) || 0) < 0)
  const lastEmitted = useRef(parseFloat(value) || 0)

  useEffect(() => {
    const incoming = parseFloat(value) || 0
    if (Math.abs(incoming - lastEmitted.current) > 0.005) {
      setDigits(valueToDigits(value))
      setIsNegative(allowNegative && incoming < 0)
      lastEmitted.current = incoming
    }
  }, [value, allowNegative])

  const handleChange = (e) => {
    const input = e.target.value
    // Kur allowNegative=true, prezenca e "-" në input e bën vlerën negative
    // (kudo brenda tekstit — user mund të shtypë "-" edhe në fund për ta togluar).
    const negative = allowNegative && /-/.test(input)
    const raw = input.replace(/\D/g, '').replace(/^0+/, '')
    setDigits(raw)
    setIsNegative(negative)
    const abs = raw === '' ? 0 : parseInt(raw, 10) / 100
    const num = negative ? -abs : abs
    lastEmitted.current = num
    onChange(num)
  }

  const displayed = digitsToDisplay(digits)
  // Kur allowNegative dhe user pat shtypur "-", mbaje "-" të dukshëm gjithmonë
  // (edhe kur digits janë bosh) që të mos humbet gjendja negative kur user shtyp
  // shifra shtesë — përndryshe minusi zhduket nga input string dhe /-/.test
  // dështon në keystroke-un pasues.
  const showValue = isNegative ? `-${displayed}` : displayed

  return (
    <input
      type="text"
      inputMode={allowNegative ? 'text' : 'numeric'}
      value={showValue}
      onChange={handleChange}
      onFocus={(e) => e.target.select()}
      className={className}
      disabled={disabled}
      placeholder={placeholder}
      {...rest}
    />
  )
}
