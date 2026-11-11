import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./Button";
import { Dialog, Sheet, SHEET_DISMISS_PX, Tabs, TabsList, TabsTrigger } from "./Overlays";

afterEach(cleanup);

const body = (dialog: HTMLElement) => dialog.querySelector<HTMLElement>("[data-panel-body]")!;
const handle = (dialog: HTMLElement) => dialog.querySelector<HTMLElement>("[data-sheet-handle]")!;

function drag(el: HTMLElement, dy: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 100 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 100 + dy });
  fireEvent.pointerUp(el, { pointerId: 1, clientY: 100 + dy });
}

describe("Dialog", () => {
  it("caps its height to the viewport and scrolls the body, not the header", () => {
    render(<Dialog open title="Tall">content</Dialog>);
    const dialog = screen.getByRole("dialog", { name: "Tall" });
    expect(dialog.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(body(dialog).className).toMatch(/overflow-y-auto/);
    expect(body(dialog).className).toMatch(/overscroll-contain/);
    expect(body(dialog)).not.toContainElement(screen.getByRole("button", { name: "Close" }));
    expect(body(dialog)).toHaveTextContent("content");
    expect(handle(dialog)).toBeNull();
  });

  it("works uncontrolled from a trigger", async () => {
    const user = userEvent.setup();
    render(<Dialog title="Hi" trigger={<Button>Open</Button>} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Hi" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Sheet", () => {
  function Controlled() {
    const [open, setOpen] = useState(true);
    return <Sheet open={open} onOpenChange={setOpen} title="Rules">body</Sheet>;
  }

  it("has a drag handle, a close button, and a body that keeps its scroll and clears the home indicator", () => {
    render(<Controlled />);
    const dialog = screen.getByRole("dialog", { name: "Rules" });
    expect(handle(dialog)).toHaveAttribute("aria-hidden");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(body(dialog).className).toMatch(/overscroll-contain/);
    expect(body(dialog).className).toContain("env(safe-area-inset-bottom)");
  });

  it("closes when the handle is dragged down far enough, and stays open on a short drag", () => {
    render(<Controlled />);
    const dialog = screen.getByRole("dialog", { name: "Rules" });
    drag(handle(dialog), SHEET_DISMISS_PX - 30);
    expect(screen.getByRole("dialog", { name: "Rules" })).toBeInTheDocument();
    expect(dialog.style.transform).toBe("");
    drag(handle(dialog), SHEET_DISMISS_PX + 10);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes uncontrolled sheets on swipe too", async () => {
    const user = userEvent.setup();
    render(<Sheet title="Side" trigger={<Button>Open</Button>} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    drag(handle(screen.getByRole("dialog", { name: "Side" })), SHEET_DISMISS_PX + 10);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it("tabs scroll sideways instead of wrapping", () => {
  render(
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">Ingredients</TabsTrigger>
        <TabsTrigger value="b">Instructions</TabsTrigger>
      </TabsList>
    </Tabs>,
  );
  expect(screen.getByRole("tablist").className).toMatch(/overflow-x-auto/);
  expect(screen.getByRole("tab", { name: "Ingredients" }).className).toMatch(/shrink-0/);
});
