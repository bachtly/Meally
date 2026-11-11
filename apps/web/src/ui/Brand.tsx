import { cn } from "./cn";

/** The Meally mark: the Koi logo next to the wordmark. The image is decorative; the name carries the meaning. */
export function Brand({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold text-accent", size === "lg" ? "text-2xl" : "text-lg", className)}>
      <img src="/logo.png" alt="" width={96} height={96} className={cn("shrink-0 rounded-lg", size === "lg" ? "size-10" : "size-8")} />
      Meally
    </span>
  );
}
