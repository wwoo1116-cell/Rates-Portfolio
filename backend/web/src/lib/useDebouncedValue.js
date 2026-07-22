import { useEffect, useState } from 'react'

// Trailing-edge debounce for fast-changing input values. <input type="date">
// fires onChange per keystroke during keyboard entry, so feeding its value
// straight into a fetching hook issues a request per intermediate date --
// debounce collapses the burst into one fetch after the user pauses.
export function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}
