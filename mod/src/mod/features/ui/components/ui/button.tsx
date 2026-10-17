import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@ui/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[filter,background-color,color,transform] outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:ring-[3px] focus-visible:ring-brand-soft",
  {
    variants: {
      // Как в Modrinth: зелёная — главное действие, серая с градиентом —
      // обычное, прозрачная — тихое. Наведение светлит, а не перекрашивает.
      variant: {
        default: "bg-brand text-primary-foreground hover:brightness-110",
        destructive: "bg-surface-4 text-[#ed4661] hover:bg-[#ed4661]/15",
        outline: "border border-surface-5 bg-transparent text-foreground hover:bg-surface-4",
        secondary: "bg-[image:var(--ms-button-gradient)] text-foreground hover:brightness-125",
        ghost: "bg-transparent text-foreground hover:bg-surface-4 hover:text-strong",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 has-[>svg]:px-3.5",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 px-6 text-[15px]",
        icon: "size-10",
        "icon-sm": "size-8",
        "icon-lg": "size-12 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
