import { cn } from '@/lib/utils'

function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-muted read-only:text-muted-foreground read-only:cursor-default',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
