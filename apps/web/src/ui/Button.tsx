import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-hover",
  secondary: "bg-raised text-ink border border-line hover:bg-sunken",
  ghost: "bg-transparent text-ink hover:bg-sunken",
  danger: "bg-danger text-accent-contrast hover:opacity-90",
};
// `sm` stays compact for a mouse but grows to the 44px touch floor on coarse pointers.
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-sm pointer-coarse:min-h-11",
  md: "min-h-11 px-4 text-base",
  lg: "min-h-12 px-6 text-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({ variant = "primary", size = "md", loading, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * A square icon-only button, 44px by default. A `className` can make it smaller for a mouse
 * (e.g. `!size-8`), but on coarse pointers `min-width`/`min-height` keep it at 44px: min sizes
 * win over `width`/`height`, even `!important` ones.
 */
export function IconButton({
  "aria-label": label,
  variant = "ghost",
  className,
  children,
  ...rest
}: Omit<ButtonProps, "aria-label" | "size"> & { "aria-label": string }) {
  return (
    <Button
      {...rest}
      aria-label={label}
      variant={variant}
      className={cn("size-11 !px-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11", className)}
    >
      {children}
    </Button>
  );
}
