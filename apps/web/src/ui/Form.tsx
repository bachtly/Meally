import {
  cloneElement,
  type ComponentProps,
  useId,
  type LabelHTMLAttributes,
  type ReactElement,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

const control =
  "w-full min-h-11 rounded-md border border-line bg-raised px-3 py-2 text-base text-ink placeholder:text-muted aria-[invalid=true]:border-danger";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input {...rest} className={cn(control, className)} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={4} {...rest} className={cn(control, className)} />;
}
export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...rest} className={cn("text-sm font-medium text-ink", className)} />;
}

/** Wires a label, hint and error message to a single control. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}) {
  const id = useId();
  const descId = `${id}-desc`;
  const described = error || hint ? descId : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id, "aria-describedby": described, "aria-invalid": error ? true : undefined })}
      {(error || hint) && (
        <p id={descId} className={cn("text-sm", error ? "text-danger" : "text-muted")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
