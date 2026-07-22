import { cn } from '@/lib/utils'

export function Slider({ className, ...props }) {
  return (
    <input
      type="range"
      className={cn(
        'w-full h-1.5 rounded-full bg-secondary accent-primary cursor-pointer touch-none',
        className,
      )}
      {...props}
    />
  )
}
