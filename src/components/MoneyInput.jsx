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

export default function MoneyInput({ value, onChange, className = '', disabled, placeholder, ...rest }) {
  const [digits, setDigits] = useState(() => valueToDigits(value))
  const lastEmitted = useRef(parseFloat(value) || 0)

  useEffect(() => {
    const incoming = parseFloat(value) || 0
    if (Math.abs(incoming - lastEmitted.current) > 0.005) {
      setDigits(valueToDigits(value))
      lastEmitted.current = incoming
    }
  }, [value])

  const handleChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '').replace(/^0+/, '')
    setDigits(raw)
    const num = raw === '' ? 0 : parseInt(raw, 10) / 100
    lastEmitted.current = num
    onChange(num)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={digitsToDisplay(digits)}
      onChange={handleChange}
      onFocus={(e) => e.target.select()}
      className={className}
      disabled={disabled}
      placeholder={placeholder}
      {...rest}
    />
  )
}
