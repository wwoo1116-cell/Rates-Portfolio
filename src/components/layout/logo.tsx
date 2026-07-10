/** Brand mark: solid black circle, white upward-pointing triangle. Replaces
 * the former "///." text mark everywhere it appeared. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="12" fill="#000000" />
      <polygon points="12,6 18,17 6,17" fill="#ffffff" />
    </svg>
  );
}
