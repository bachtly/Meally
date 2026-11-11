import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useMeta } from "../../lib/meta";

export const POLL_MS = 5000;

/**
 * Keeps a shopping list fresh. With server streaming it subscribes to the SSE stream (reconnecting with
 * backoff); otherwise it polls every 5 s while the tab is visible and pauses while hidden. The list GET
 * sends an ETag, so an unchanged poll is a cheap 304. Returns whether updates are arriving live.
 */
export function useListEvents(listId: string) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [live, setLive] = useState(false);
  const streaming = meta.data?.streaming;
  useEffect(() => {
    if (streaming === undefined) return;
    const refetch = () => void qc.invalidateQueries({ queryKey: ["shopping"] });
    if (!streaming || typeof EventSource === "undefined") return startPolling(refetch, setLive);
    let es: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;
    const connect = () => {
      es = new EventSource(`/api/v1/shopping/lists/${listId}/events`);
      es.addEventListener("ready", () => {
        attempt = 0;
        setLive(true);
      });
      es.addEventListener("items", refetch);
      es.addEventListener("list", refetch);
      es.addEventListener("deleted", refetch);
      es.onerror = () => {
        setLive(false);
        es?.close();
        if (closed) return;
        timer = setTimeout(() => {
          connect();
          refetch(); // catch up on anything missed while disconnected
        }, Math.min(30_000, 1000 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      es?.close();
    };
  }, [listId, qc, streaming]);
  return live;
}

/** Interval polling that stops while the tab is hidden and refreshes at once when it returns. */
export function startPolling(refetch: () => void, setLive: (v: boolean) => void): () => void {
  let id: ReturnType<typeof setInterval> | undefined;
  const start = () => {
    if (id !== undefined) return;
    id = setInterval(refetch, POLL_MS);
    setLive(true);
  };
  const stop = () => {
    clearInterval(id);
    id = undefined;
    setLive(false);
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      refetch();
      start();
    } else stop();
  };
  if (document.visibilityState === "visible") start();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    stop();
  };
}
