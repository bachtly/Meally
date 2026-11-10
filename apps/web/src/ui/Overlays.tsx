import * as RDialog from "@radix-ui/react-dialog";
import * as RMenu from "@radix-ui/react-dropdown-menu";
import * as RTabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { IconButton } from "./Button";

interface PanelProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}

function Panel({ trigger, title, description, children, contentClass, ...root }: PanelProps & { contentClass: string }) {
  return (
    <RDialog.Root {...root}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <RDialog.Content className={cn("fixed z-50 flex flex-col gap-4 bg-raised p-5 text-ink shadow-md", contentClass)}>
          <div className="flex items-start justify-between gap-4">
            <RDialog.Title className="text-xl font-semibold">{title}</RDialog.Title>
            <RDialog.Close asChild>
              <IconButton aria-label="Close">
                <X className="size-5" aria-hidden />
              </IconButton>
            </RDialog.Close>
          </div>
          <RDialog.Description className={description ? "text-muted" : "sr-only"}>{description ?? title}</RDialog.Description>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Dialog(props: PanelProps) {
  return (
    <Panel
      {...props}
      contentClass="left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg"
    />
  );
}

/** Bottom sheet below 1024 px, right-hand side panel from 1024 px up. */
export function Sheet(props: PanelProps) {
  return (
    <Panel
      {...props}
      contentClass="inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-lg lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-96 lg:rounded-none lg:rounded-l-lg"
    />
  );
}

export const DropdownMenu = RMenu.Root;
export const DropdownMenuTrigger = RMenu.Trigger;
export function DropdownMenuContent({ className, ...rest }: ComponentProps<typeof RMenu.Content>) {
  return (
    <RMenu.Portal>
      <RMenu.Content
        sideOffset={6}
        {...rest}
        className={cn("z-50 min-w-48 rounded-md border border-line bg-raised p-1 text-ink shadow-md", className)}
      />
    </RMenu.Portal>
  );
}
export function DropdownMenuItem({ className, ...rest }: ComponentProps<typeof RMenu.Item>) {
  return (
    <RMenu.Item
      {...rest}
      className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-3 text-base outline-none data-[highlighted]:bg-sunken", className)}
    />
  );
}

export const Tabs = RTabs.Root;
export function TabsList({ className, ...rest }: ComponentProps<typeof RTabs.List>) {
  return <RTabs.List {...rest} className={cn("flex gap-1 border-b border-line", className)} />;
}
export function TabsTrigger({ className, ...rest }: ComponentProps<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      {...rest}
      className={cn("min-h-11 border-b-2 border-transparent px-4 text-base text-muted data-[state=active]:border-accent data-[state=active]:text-ink", className)}
    />
  );
}
export const TabsContent = RTabs.Content;
