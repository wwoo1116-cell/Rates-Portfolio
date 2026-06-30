import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-semibold',
  {
    variants: {
      variant: {
        default:  'bg-primary text-primary-foreground',
        outline:  'border border-border text-muted-foreground',
        positive: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        negative: 'bg-red-50 text-red-700 border border-red-200',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
