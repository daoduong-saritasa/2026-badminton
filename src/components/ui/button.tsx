import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-pill border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors outline-none select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:border-mist disabled:bg-mist disabled:text-muted-ink aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-orange text-white hover:bg-[#cf4519]",
        outline: "border-line bg-white text-ink hover:bg-well",
        secondary: "bg-mist text-navy hover:bg-navy-soft",
        ghost: "text-muted-ink hover:bg-mist hover:text-ink",
        destructive:
          "bg-[#fdeceb] text-[#a32118] hover:bg-[#fbdedb] aria-invalid:border-destructive",
        link: "rounded-none text-navy underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 gap-2 px-[1.1875rem]",
        xs: "h-9 gap-1.5 px-3",
        sm: "h-11 gap-1.5 px-4",
        lg: "h-12 gap-2 px-6 text-sm",
        icon: "size-11",
        "icon-xs": "size-9 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-11",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
