export const DEFAULT_SW_PATH = '/sw.js';
export const DEFAULT_HEARTBEAT_INTERVAL = 2000;

// TODO: adds read from .env
export const DEFAULT_STALE_TIMEOUT = {
  SW: 2000,
  BROADCAST: 2000,
};

export const EVENTS = {
  TAKE_OVER: 'take_over',
  SKIP_WAITING: 'skipWaiting',
  PING: 'ping',
  AM_I_ACTIVE: 'am-i-active',
};
