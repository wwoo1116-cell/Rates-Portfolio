import { cn } from '@/lib/utils'

function Label({ className, ...props }) {
  return (
    <label
      className={cn('text-xs font-medium text-muted-foreground leading-none', className)}
      {...props}
    />
  )
}

export { Label }
