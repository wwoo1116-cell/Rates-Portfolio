import { Input } from './input'

// Displays a plain digit-string value (e.g. notional amounts) with
// thousands-separator commas while keeping the underlying value/onChange
// contract identical to a normal <input> -- callers keep storing/reading the
// raw digit string (no commas), so existing Number(value) conversions are
// unaffected; only the rendered text gains commas.
function formatDigits(digits) {
  if (!digits) return ''
  return Number(digits).toLocaleString('en-US')
}

export function NumberInput({ value, onChange, ...props }) {
  function handleChange(e) {
    const digits = e.target.value.replace(/[^\d]/g, '')
    onChange({ target: { value: digits } })
  }

  return <Input type="text" inputMode="numeric" value={formatDigits(value)} onChange={handleChange} {...props} />
}
