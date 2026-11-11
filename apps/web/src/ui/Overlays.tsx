import * as RDialog from "@radix-ui/react-dialog";
import * as RMenu from "@radix-ui/react-dropdown-menu";
import * as RTabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { useRef, useState, type ComponentProps, type PointerEvent, type ReactNode, type RefObject } from "react";
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

interface PanelLayout {
  contentClass: string;
  bodyClass?: string;
  /** Rendered above the header, e.g. the bottom sheet's drag handle. */
  top?: (close: () => void, content: RefObject<HTMLDivElement | null>) => ReactNode;
}

/**
 * The header (title + close) stays put; the body scrolls on its own and does not chain
 * scrolling to the page behind (overscroll-behavior: contain).
 */
function Panel({ trigger, title, description, children, contentClass, bodyClass, top, open: openProp, onOpenChange }: PanelProps & PanelLayout) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => {
    if (openProp === undefined) setOpenState(o);
    onOpenChange?.(o);
  };
  const content = useRef<HTMLDivElement>(null);
  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-scrim motion-safe:data-[state=open]:animate-[overlay-in_200ms_ease-out] motion-safe:data-[state=closed]:animate-[overlay-out_150ms_ease-in]" />
        <RDialog.Content ref={content} className={cn("fixed z-50 flex flex-col overflow-hidden bg-raised text-ink shadow-md", contentClass)}>
          {top?.(() => setOpen(false), content)}
          <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-4">
            <RDialog.Title className="pt-2 text-xl font-semibold">{title}</RDialog.Title>
            <RDialog.Close asChild>
              <IconButton aria-label="Close" className="-mr-2 shrink-0">
                <X className="size-5" aria-hidden />
              </IconButton>
            </RDialog.Close>
          </div>
          <div data-panel-body className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pt-2 pb-5", bodyClass)}>
            <RDialog.Description className={description ? "text-muted" : "sr-only"}>{description ?? title}</RDialog.Description>
            {children}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Dialog(props: PanelProps) {
  return (
    <Panel
      {...props}
      contentClass="left-1/2 top-1/2 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg motion-safe:data-[state=open]:animate-[dialog-in_200ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_150ms_ease-in]"
    />
  );
}

/** How far (px) the sheet has to be dragged down before letting go closes it. */
export const SHEET_DISMISS_PX = 80;

/** Drag handle for the bottom sheet. Dragging it down far enough closes the sheet; the close button stays. */
function SheetHandle({ close, content }: { close: () => void; content: RefObject<HTMLDivElement | null> }) {
  const drag = useRef<{ y: number; id: number } | null>(null);
  const moveTo = (dy: number) => {
    const el = content.current;
    if (el) el.style.transform = dy ? `translateY(${dy}px)` : "";
  };
  const end = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const dy = e.clientY - drag.current.y;
    drag.current = null;
    moveTo(0);
    if (!cancelled && dy >= SHEET_DISMISS_PX) close();
  };
  return (
    <div
      data-sheet-handle
      aria-hidden
      className="flex h-6 shrink-0 cursor-grab touch-none items-end justify-center lg:hidden"
      onPointerDown={(e) => {
        drag.current = { y: e.clientY, id: e.pointerId };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current?.id === e.pointerId) moveTo(Math.max(0, e.clientY - drag.current.y));
      }}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
    >
      <span className="h-1.5 w-10 rounded-full bg-line" />
    </div>
  );
}

/** Bottom sheet below 1024 px, right-hand side panel from 1024 px up. */
export function Sheet(props: PanelProps) {
  return (
    <Panel
      {...props}
      top={(close, content) => <SheetHandle close={close} content={content} />}
      contentClass="inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg motion-safe:data-[state=open]:animate-[sheet-up-in_250ms_ease-out] motion-safe:data-[state=closed]:animate-[sheet-up-out_200ms_ease-in] lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-96 lg:rounded-none lg:rounded-l-lg lg:motion-safe:data-[state=open]:animate-[sheet-side-in_250ms_ease-out] lg:motion-safe:data-[state=closed]:animate-[sheet-side-out_200ms_ease-in]"
      bodyClass="pb-[calc(1.25rem+env(safe-area-inset-bottom))] lg:pb-5"
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
  return <RTabs.List {...rest} className={cn("flex gap-1 overflow-x-auto overscroll-x-contain border-b border-line [scrollbar-width:thin]", className)} />;
}
export function TabsTrigger({ className, ...rest }: ComponentProps<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      {...rest}
      className={cn("min-h-11 shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 text-base text-muted data-[state=active]:border-accent data-[state=active]:text-ink", className)}
    />
  );
}
export const TabsContent = RTabs.Content;
