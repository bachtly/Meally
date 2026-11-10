import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn("rounded-lg border border-line bg-raised shadow-sm", className)} />;
}

const tones = {
  neutral: "bg-sunken text-ink",
  accent: "bg-accent text-accent-contrast",
  success: "bg-sunken text-success",
  danger: "bg-sunken text-danger",
};

export function Badge({ tone = "neutral", className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span {...rest} className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)} />
  );
}

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden {...rest} className={cn("animate-pulse rounded-md bg-sunken", className)} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      {icon && (
        <div className="text-muted" aria-hidden>
          {icon}
        </div>
      )}
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <p className="max-w-sm text-muted">{children}</p>}
      {action}
    </div>
  );
}
