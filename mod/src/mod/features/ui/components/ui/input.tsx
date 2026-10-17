import * as React from "react";

import { cn } from "@ui/lib/utils";

/** Поле ввода в духе Modrinth: утопленное в слой ниже карточки, зелёный фокус. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border border-surface-5 bg-surface-1 px-3 text-sm text-strong",
        "placeholder:text-muted-foreground selection:bg-brand selection:text-primary-foreground",
        "transition-[border-color,box-shadow] outline-none hover:border-[#34363c]",
        "focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand-soft",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
