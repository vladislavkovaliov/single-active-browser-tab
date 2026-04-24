export interface IServiceWorkerStrategyOptions {
  /** Called when this tab becomes active. */
  onActive?: () => void;
  /** Called when this tab is blocked by another active tab. */
  onBlocked?: () => void;
  /** Path to the service worker script (default: '/sw.js') */
  swPath?: string;
  /** Heartbeat interval in ms (default: 2000) */
  heartbeatInterval?: number;
  /** Minimum log level to output (default: 'log') */
  logLevel?: 'error' | 'warn' | 'log';
}
