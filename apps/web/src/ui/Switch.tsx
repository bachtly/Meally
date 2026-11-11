import * as RSwitch from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/** A toggle. Pass `aria-label` or wrap it in a `<label>`. */
export function Switch({ className, ...rest }: ComponentProps<typeof RSwitch.Root>) {
  return (
    <RSwitch.Root
      {...rest}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-line bg-sunken transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50",
        className,
      )}
    >
      <RSwitch.Thumb className="block size-5 translate-x-1 rounded-full bg-raised shadow-sm transition-transform data-[state=checked]:translate-x-6" />
    </RSwitch.Root>
  );
}
