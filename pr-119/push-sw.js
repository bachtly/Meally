/* Web Push for Meally (F8). Imported into the generated service worker (vite.config.ts, workbox.importScripts).
   The payload is { type: "snap" | "reaction", snapId, from, emoji? }: no caption or photo ever leaves the server. */
const EMOJI = { heart: "❤️", yum: "😋", fire: "🔥", clap: "👏", wow: "😮", laugh: "😂" };

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = {};
  }
  const from = typeof d.from === "string" && d.from ? d.from : "A friend";
  const reaction = d.type === "reaction";
  const title = reaction ? `${from} reacted ${EMOJI[d.emoji] || ""}`.trim() : `${from} sent a Snap`;
  const body = reaction ? "Tap to see your Snap." : "Tap to see it.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // A push sent twice (a retry after a crash) replaces the first notification instead of stacking.
      tag: [d.type, d.snapId, from, d.emoji].filter(Boolean).join(":"),
      data: { url: d.snapId ? `/snaps/${encodeURIComponent(d.snapId)}` : "/feed" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/feed", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        await w.focus();
        if ("navigate" in w) await w.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
