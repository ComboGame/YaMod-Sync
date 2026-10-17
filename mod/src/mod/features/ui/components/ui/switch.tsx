import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@ui/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none",
        "data-[state=checked]:bg-brand data-[state=unchecked]:bg-surface-5",
        "focus-visible:ring-[3px] focus-visible:ring-brand-soft disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[18px] rounded-full shadow-sm transition-transform",
          "data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-primary-foreground",
          "data-[state=unchecked]:translate-x-[3px] data-[state=unchecked]:bg-[#96a2b0]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
