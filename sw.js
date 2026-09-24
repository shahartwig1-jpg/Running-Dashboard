// Service worker: its only job is to receive push notifications while the app is closed
// and to open the dashboard when one is tapped. It deliberately does no caching, so the
// site always loads fresh, exactly like a normal web page.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Eyal's Angels 👼", {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag,
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ("focus" in c) return c.focus();
    }
    return self.clients.openWindow(url);
  }));
});
