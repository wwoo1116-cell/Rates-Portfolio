import { cn } from '@/lib/utils'

const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'portfolio', label: 'Swaps Portfolio' },
  { key: 'risk', label: 'Risk Analytics' },
]

export function PortfolioSidebar({ active, onChange }) {
  return (
    <nav className="w-48 shrink-0 border-r border-border pr-4 space-y-1">
      {SECTIONS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            'block w-full rounded-md px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide transition-colors',
            active === key
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50',
          )}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}
