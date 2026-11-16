// HonorCat service worker: shows pot notifications (web push) and opens the pot on click.
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (_) {
    d = { title: "HonorCat", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "HonorCat", { body: d.body || "", icon: "/icon.svg", data: { url: d.url || "/pots" } }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/pots";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.endsWith(url) && "focus" in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});
