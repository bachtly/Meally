import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/** Subscribes to a list's SSE stream, refetching on changes; reconnects with backoff. Returns whether it is live. */
export function useListEvents(listId: string) {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let es: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;
    const refetch = () => void qc.invalidateQueries({ queryKey: ["shopping"] });
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
  }, [listId, qc]);
  return live;
}
