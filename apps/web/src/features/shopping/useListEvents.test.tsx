import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POLL_MS, startPolling, useListEvents } from "./useListEvents";

let streaming = false;
let listFetches = 0;
let visibility: "visible" | "hidden" = "visible";

function Probe() {
  return <p>{useListEvents("l1") ? "live" : "idle"}</p>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  listFetches = 0;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/meta") ? Response.json({ streaming, presizedImages: false }) : Response.json({}))));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(qc: QueryClient) {
  render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
}

it("polls every 5 s while visible, pauses when hidden, and resumes with an immediate refresh", async () => {
  const qc = new QueryClient();
  vi.spyOn(qc, "invalidateQueries").mockImplementation(async () => void listFetches++);
  mount(qc);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText("live")).toBeInTheDocument();
  await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS * 3)));
  expect(listFetches).toBe(3);

  visibility = "hidden";
  await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS * 4)));
  expect(listFetches).toBe(3);
  expect(screen.getByText("idle")).toBeInTheDocument();

  visibility = "visible";
  await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
  expect(listFetches).toBe(4);
  await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
  expect(listFetches).toBe(5);
});

it("uses SSE, not polling, when the server streams", async () => {
  streaming = true;
  const sources: string[] = [];
  vi.stubGlobal(
    "EventSource",
    class {
      constructor(url: string) {
        sources.push(url);
      }
      addEventListener() {}
      close() {}
    },
  );
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  mount(qc);
  await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS * 2)));
  expect(sources).toEqual(["/api/v1/shopping/lists/l1/events"]);
  expect(spy).not.toHaveBeenCalled();
  streaming = false;
});

it("startPolling stops its timer on cleanup", () => {
  const refetch = vi.fn();
  const stop = startPolling(refetch, () => {});
  vi.advanceTimersByTime(POLL_MS);
  expect(refetch).toHaveBeenCalledTimes(1);
  stop();
  vi.advanceTimersByTime(POLL_MS * 3);
  expect(refetch).toHaveBeenCalledTimes(1);
});
