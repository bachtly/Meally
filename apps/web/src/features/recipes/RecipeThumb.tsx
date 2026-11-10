import type { CSSProperties } from "react";
import { cn } from "../../ui";
import { imageSrcSet, warmHue } from "./format";

/** Recipe photo, or the warm per-recipe placeholder with the name's initial. Size comes from className. */
export function RecipeThumb({
  name,
  imageUrl,
  sizes = "80px",
  className,
  textClass = "text-lg",
  lazy,
}: {
  name: string;
  imageUrl: string | null | undefined;
  sizes?: string;
  className?: string;
  textClass?: string;
  lazy?: boolean;
}) {
  if (imageUrl) {
    return <img src={imageUrl} srcSet={imageSrcSet(imageUrl)} sizes={sizes} alt="" loading={lazy ? "lazy" : undefined} className={cn("object-cover", className)} />;
  }
  return (
    <span aria-hidden style={{ "--h": warmHue(name) } as CSSProperties} className={cn("recipe-tint flex items-center justify-center font-semibold", textClass, className)}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
