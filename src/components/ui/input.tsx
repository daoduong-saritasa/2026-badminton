import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-field border border-line bg-white px-3.5 py-3 text-[0.8125rem] transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-ink/70 focus-visible:border-navy focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-mist disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-hairline disabled:bg-well disabled:text-muted-ink aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
