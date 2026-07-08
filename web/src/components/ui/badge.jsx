import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-semibold',
  {
    variants: {
      variant: {
        default:  'bg-primary text-primary-foreground',
        outline:  'border border-border text-muted-foreground',
        positive: 'bg-positive/10 text-positive',
        negative: 'bg-negative/10 text-negative',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
