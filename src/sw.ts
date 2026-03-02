/// <reference lib="webworker" />

console.log('[SingleTab SW] script loaded');

const CACHE_NAME = 'single-tab-v1';
const STATE_KEY = 'https://single-tab/state';
const STALE_MS = 2000;

interface IStoredState {
  clientId: string;
  tabId: string;
  lastSeen: number;
}

const EVENTS = {
  TAKE_OVER: "take_over",
  SKIP_WAITING: "skipWaiting",
  PING: "ping",
  AM_I_ACTIVE: "am-i-active",
  PONG: "pong"
}

async function getState(): Promise<IStoredState | null> {
  const cache = await caches.open(CACHE_NAME);

  const res = await cache.match(STATE_KEY);
  
  if (!res) {
    return null;
  }
  
  try {
    return (await res.json()) as IStoredState;
  } catch {
    return null;
  }
}

async function setState(state: IStoredState): Promise<void> {
  const cache = await caches.open(CACHE_NAME);

  await cache.put(STATE_KEY, new Response(JSON.stringify(state)));
}

function isStale(state: IStoredState | null): boolean {
  return !state || Date.now() - state.lastSeen > STALE_MS;
}

self.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { type?: string; tabId?: string };
  const type = data?.type ?? '';

  console.log(data);

  // event.source can be a Client, ServiceWorker, or MessagePort; only Client has 'id'
  const clientId =
    event.source && "id" in event.source
      ? (event.source as unknown as Client).id
      : "";

  console.log('[SingleTab SW] message received:', type, 'clientId=', clientId);

  if (type === 'skipWaiting') {
    console.log('[SingleTab SW] skipWaiting');
    
    (self as unknown as ServiceWorkerGlobalScope).skipWaiting();
    
    return;
  }

  const { tabId } = data ?? {};

  const now = Date.now();

  if (type === EVENTS.PING && tabId) {
    // Heartbeat должен продлевать жизнь только текущему владельцу.
    // Если стейта нет или tabId не совпадает с владельцем – игнорируем PING.
    getState().then((state) => {
      if (!state || state.tabId !== tabId) {
        console.log(
          '[SingleTab SW] ping ignored: not owner',
          'state.tabId=',
          state?.tabId,
          'tabId=',
          tabId
        );
        return;
      }

      setState({ ...state, clientId, lastSeen: now }).then(() => {
        (event.source as unknown as Client).postMessage({ type: EVENTS.PONG });
      });

      console.log('[SingleTab SW] ping from owner -> pong sent, state updated');
    });

    return;
  }

  if (type === EVENTS.TAKE_OVER) {
    const source = event.source as unknown as Client;

    setState({ clientId, tabId: tabId ?? '', lastSeen: now }).then(() =>
      (self as unknown as ServiceWorkerGlobalScope).clients.matchAll().then((allClients: readonly Client[]) => {
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

      // Проверяем, жив ли текущий владелец по clientId.
      let ownerAlive = false;
      if (state && state.clientId) {
        try {
          const ownerClient = await (self as unknown as ServiceWorkerGlobalScope).clients.get(
            state.clientId
          );
          ownerAlive = !!ownerClient;
        } catch {
          ownerAlive = false;
        }
      }

      const isSameTab = state && state.tabId === (tabId ?? '');
      const noOwner = !state || !ownerAlive;
      const active = noOwner || isSameTab;

      console.log(
        '[SingleTab SW] am-i-active: state=',
        state,
        'ownerAlive=',
        ownerAlive,
        'isSameTab=',
        isSameTab,
        '-> active=',
        active
      );

      if (active) {
        await setState({ clientId, tabId: tabId ?? '', lastSeen: Date.now() });
      }

      (event.source as unknown as Client).postMessage({
        type: EVENTS.AM_I_ACTIVE,
        active,
      });

      console.log('[SingleTab SW] am-i-active response sent, active=', active);
    })();
  }
});

self.addEventListener('install', () => {
  console.log('[SingleTab SW] install');
});

self.addEventListener('activate', (event) => {
  console.log('[SingleTab SW] activate');

  (event as ExtendableEvent).waitUntil((self as unknown as ServiceWorkerGlobalScope).clients.claim());
});
