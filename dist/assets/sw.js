// src/sw.ts
console.log("[SingleTab SW] script loaded");
var CACHE_NAME = "single-tab-v1";
var STATE_KEY = "https://single-tab/state";
var EVENTS = {
  TAKE_OVER: "take_over",
  SKIP_WAITING: "skipWaiting",
  PING: "ping",
  AM_I_ACTIVE: "am-i-active",
  PONG: "pong"
};
async function getState() {
  const cache = await caches.open(CACHE_NAME);
  const res = await cache.match(STATE_KEY);
  if (!res) {
    return null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}
async function setState(state) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(STATE_KEY, new Response(JSON.stringify(state)));
}
self.addEventListener("message", (event) => {
  const data = event.data;
  const type = data?.type ?? "";
  console.log(data);
  const clientId = event.source && "id" in event.source ? event.source.id : "";
  console.log("[SingleTab SW] message received:", type, "clientId=", clientId);
  if (type === "skipWaiting") {
    console.log("[SingleTab SW] skipWaiting");
    self.skipWaiting();
    return;
  }
  const { tabId } = data ?? {};
  const now = Date.now();
  if (type === EVENTS.PING && tabId) {
    getState().then((state) => {
      if (!state || state.tabId !== tabId) {
        console.log(
          "[SingleTab SW] ping ignored: not owner",
          "state.tabId=",
          state?.tabId,
          "tabId=",
          tabId
        );
        return;
      }
      setState({ ...state, clientId, lastSeen: now }).then(() => {
        event.source.postMessage({ type: EVENTS.PONG });
      });
      console.log("[SingleTab SW] ping from owner -> pong sent, state updated");
    });
    return;
  }
  if (type === EVENTS.TAKE_OVER) {
    const source = event.source;
    setState({ clientId, tabId: tabId ?? "", lastSeen: now }).then(
      () => self.clients.matchAll().then((allClients) => {
        for (const client of allClients) {
          if (client.id === source.id) {
            client.postMessage({ type: EVENTS.AM_I_ACTIVE, active: true });
          } else {
            client.postMessage({ type: EVENTS.AM_I_ACTIVE, active: false });
          }
        }
      })
    );
    return;
  }
  if (type === EVENTS.AM_I_ACTIVE) {
    (async () => {
      const state = await getState();
      let ownerAlive = false;
      if (state && state.clientId) {
        try {
          const ownerClient = await self.clients.get(
            state.clientId
          );
          ownerAlive = !!ownerClient;
        } catch {
          ownerAlive = false;
        }
      }
      const isSameTab = state && state.tabId === (tabId ?? "");
      const noOwner = !state || !ownerAlive;
      const active = noOwner || isSameTab;
      console.log(
        "[SingleTab SW] am-i-active: state=",
        state,
        "ownerAlive=",
        ownerAlive,
        "isSameTab=",
        isSameTab,
        "-> active=",
        active
      );
      if (active) {
        await setState({ clientId, tabId: tabId ?? "", lastSeen: Date.now() });
      }
      event.source.postMessage({
        type: EVENTS.AM_I_ACTIVE,
        active
      });
      console.log("[SingleTab SW] am-i-active response sent, active=", active);
    })();
  }
});
self.addEventListener("install", () => {
  console.log("[SingleTab SW] install");
});
self.addEventListener("activate", (event) => {
  console.log("[SingleTab SW] activate");
  event.waitUntil(self.clients.claim());
});
//# sourceMappingURL=sw.js.map