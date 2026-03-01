/// <reference lib="webworker" />

console.log('[SingleTab SW] script loaded');

const CACHE_NAME = 'single-tab-v1';
const STATE_KEY = 'https://single-tab/state';
const STALE_MS = 5000;

interface IStoredState {
  clientId: string;
  tabId: string;
  lastSeen: number;
}

const EVENTS = {
  TAKE_OVER: "take_over",
  SKIP_WAITING: "skipWaiting",
  PING: "ping",
  AM_I_ACTIVE: "am-i-active"
}

async function getState(): Promise<IStoredState | null> {
  const cache = await caches.open(CACHE_NAME);

  const res = await cache.match(STATE_KEY);
  
  if (!res) return null;
  
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

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string; tabId?: string };
  const type = data?.type ?? '';

  console.log('[SingleTab SW] message received:', type, 'clientId=', event.source?.id);

  if (type === 'skipWaiting') {
    console.log('[SingleTab SW] skipWaiting');
    
    self.skipWaiting();
    
    return;
  }

  const { tabId } = data ?? {};
  const clientId = event.source?.id ?? '';
  const now = Date.now();

  if (type === EVENTS.PING) {
    setState({ clientId, tabId: tabId ?? '', lastSeen: now });
    (event.source as Client).postMessage({ type: 'pong' });
    console.log('[SingleTab SW] ping -> pong sent');
    return;
  }

  if (type === EVENTS.TAKE_OVER) {
    const source = event.source as Client;
    
    setState({ clientId, tabId: tabId ?? '', lastSeen: now }).then(() =>
      self.clients.matchAll().then((allClients) => {
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
    getState().then((state) => {
      const stale = isStale(state);
      const isSameClient = state && state.clientId === clientId;
      const active = stale || isSameClient;

      console.log('[SingleTab SW] am-i-active: state=', state, 'stale=', stale, 'isSameClient=', isSameClient, '-> active=', active);

      if (active) {
        setState({ clientId, tabId: tabId ?? '', lastSeen: now });
      }

      (event.source as Client).postMessage({
        type: EVENTS.AM_I_ACTIVE,
        active,
      });
      console.log('[SingleTab SW] am-i-active response sent, active=', active);
    });
  }
});

self.addEventListener('install', () => {
  console.log('[SingleTab SW] install');
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  console.log('[SingleTab SW] activate');
  event.waitUntil(self.clients.claim());
});
