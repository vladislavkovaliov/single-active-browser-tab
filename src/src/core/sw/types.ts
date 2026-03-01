export interface IServiceWorkerStrategyOptions {
    onActive?: () => void;
    onBlocked?: () => void;
    /** Path to the service worker script (default: '/sw.js') */
    swPath?: string;
    /** Heartbeat interval in ms (default: 2000) */
    heartbeatInterval?: number;
  }