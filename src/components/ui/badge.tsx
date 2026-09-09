import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-pill border border-transparent whitespace-nowrap transition-colors has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-navy px-3 py-1.5 text-[0.625rem] text-white",
        secondary: "bg-mist px-3 py-1.5 text-[0.625rem] font-semibold text-navy",
        destructive:
          "bg-[#fdeceb] px-3 py-1.5 text-[0.625rem] text-[#a32118]",
        outline:
          "border-navy-soft bg-mist px-3.5 py-2.5 text-[0.625rem] text-navy",
        ghost: "px-3 py-1.5 text-[0.625rem] text-muted-ink hover:bg-mist",
        link: "text-navy underline-offset-4 hover:underline",
        /*
         * Match state. A dot plus a label rather than a bordered chip — it sits
         * inside a card head that already has a border, and a second border
         * there reads as clutter.
         */
        status:
          "gap-[0.4375rem] px-0 text-[0.6875rem] font-normal text-navy before:size-1.5 before:rounded-full before:bg-current before:content-['']",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
