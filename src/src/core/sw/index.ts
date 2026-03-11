import { IServiceWorkerStrategyOptions } from './types';
import { DEFAULT_SW_PATH, DEFAULT_HEARTBEAT_INTERVAL, EVENTS } from './constants';

/**
 * Common contract for strategies that coordinate a single active browser tab.
 */
export interface TabStrategy {
  /**
   * Initialize and start the strategy.
   */
  start(): void;
  /**
   * Stop the strategy and release any resources.
   */
  stop(): void;
  /**
   * Returns whether this strategy considers the current tab active.
   */
  isActive?(): boolean;
  /**
   * Force this tab to become active, if the strategy supports it.
   */
  takeover?(): void;
}

/**
 * Service worker–based implementation of {@link TabStrategy}.
 *
 * Registers a service worker, coordinates active tab ownership via
 * `postMessage`, and uses periodic heartbeats to keep the worker informed.
 */
export class ServiceWorkerStrategy implements TabStrategy {
  private readonly options: Required<
    Omit<IServiceWorkerStrategyOptions, 'onActive' | 'onBlocked'>
  > &
    Pick<IServiceWorkerStrategyOptions, 'onActive' | 'onBlocked'>;

  private readonly tabId: string;

  private registration: ServiceWorkerRegistration | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  private isStarted = false;
  private active: boolean = false;

  /**
   * Creates a new service worker strategy instance.
   *
   * @param options Optional configuration:
   *  - `swPath`: Path to the service worker script.
   *  - `heartbeatInterval`: Interval (ms) between heartbeat messages.
   *  - `onActive`: Callback invoked when this tab becomes active.
   *  - `onBlocked`: Callback invoked when this tab is blocked.
   */
  constructor(options: IServiceWorkerStrategyOptions = {}) {
    // Stable tabId within one browser tab (sessionStorage is per-tab).
    let tabId = `${Date.now()}-${Math.random()}`;

    try {
      if (typeof window !== 'undefined' && 'sessionStorage' in window) {
        // как будто всегда будет новый id потому что сессия стор тухнет со новой вкладкой
        const key = 'single-tab-manager-tab-id';

        const existing = window.sessionStorage.getItem(key);

        if (existing) {
          tabId = existing;
        } else {
          window.sessionStorage.setItem(key, tabId);
        }
      }
    } catch {
      // ignore storage errors, fallback to random tabId
    }
    this.tabId = tabId;

    this.options = {
      swPath: options.swPath ?? DEFAULT_SW_PATH,
      heartbeatInterval: options.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      onActive: options.onActive,
      onBlocked: options.onBlocked,
    };
  }

  /**
   * Starts the strategy: registers the service worker, hooks listeners
   * and begins heartbeats if this tab is reported as active.
   */
  start(): void {
    console.log('[SingleTab] ServiceWorkerStrategy.start()');

    if (this.isStarted) {
      return;
    }

    this.isStarted = true;

    this.registerAndStart();
  }

  /**
   * Stops the strategy: halts heartbeats, removes listeners and clears
   * the worker registration reference for this instance.
   */
  stop(): void {
    if (!this.isStarted) {
      return;
    }

    this.isStarted = false;

    this.stopHeartbeat();
    this.removeMessageListener();

    this.registration = null;
  }

  /**
   * Returns whether this tab is currently considered active by the strategy.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Take over as the active tab. This tab becomes active; other tabs receive
   * a message from the worker that they are no longer active (`onBlocked`).
   */
  takeover(): void {
    const controller = navigator.serviceWorker.controller;

    if (!controller) {
      return;
    }

    controller.postMessage({
      type: EVENTS.TAKE_OVER,
      tabId: this.tabId,
    });
  }

  /**
   * Registers the service worker (if available) and wires up update handling,
   * message listeners and initial active-status negotiation.
   */
  private async registerAndStart(): Promise<void> {
    if ('serviceWorker' in navigator === false) {
      console.log('[SingleTab] No serviceWorker in navigator');

      if (this.options.onBlocked) {
        this.options.onBlocked();
      }

      return;
    }

    try {
      console.log('[SingleTab] Registering SW:', this.options.swPath);

      this.registration = await navigator.serviceWorker.register(this.options.swPath, {
        scope: '/',
      });

      console.log(
        '[SingleTab] SW registered, state:',
        this.registration.active?.state,
        this.registration.installing?.state,
        this.registration.waiting?.state
      );

      if (this.registration.waiting) {
        console.log(`[SingleTab] SW waiting -> postMessage(${EVENTS.SKIP_WAITING})`);

        this.registration.waiting.postMessage({ type: EVENTS.SKIP_WAITING });
      }

      this.registration.addEventListener('updatefound', () => {
        const newWorker = this.registration?.installing;

        console.log('[SingleTab] updatefound, installing:', Boolean(newWorker));

        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            console.log('[SingleTab] installing statechange:', newWorker.state);

            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: EVENTS.SKIP_WAITING });
            }
          });
        }
      });

      console.log('[SingleTab] Waiting for navigator.serviceWorker.ready...');

      await navigator.serviceWorker.ready;

      console.log('[SingleTab] ready. controller:', Boolean(navigator.serviceWorker.controller));

      this.registration.update();

      this.addMessageListener();

      if (navigator.serviceWorker.controller) {
        console.log('[SingleTab] Controller exists -> requestAmIActive + maybe startHeartbeat');

        await this.requestAmIActive();

        if (this.active) {
          this.startHeartbeat();
        }
      } else {
        console.log('[SingleTab] No controller -> waiting for controllerchange...');

        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            () => {
              console.log('[SingleTab] controllerchange fired');

              resolve();
            },
            { once: true }
          );
        });

        console.log(
          '[SingleTab] After controllerchange -> requestAmIActive + maybe startHeartbeat'
        );

        await this.requestAmIActive();

        if (this.active) {
          this.startHeartbeat();
        }
      }
      console.log('[SingleTab] registerAndStart done, active:', this.active);
    } catch (err) {
      console.error('[SingleTab] registration failed', err);

      this.options.onBlocked?.();
    }
  }

  /**
   * Subscribes to `message` events from the service worker and updates
   * this tab's active state based on worker responses.
   */
  private addMessageListener(): void {
    this.messageHandler = (event: MessageEvent) => {
      // TODO: infer from EVENTS
      const data = event.data as { type?: string; active?: boolean };

      if (data?.type === EVENTS.AM_I_ACTIVE) {
        const wasActive = this.active;
        this.active = data.active === true;

        console.log(`[SingleTab] message from SW: ${EVENTS.AM_I_ACTIVE}, active=`, this.active);

        // Синхронизируем heartbeat с текущим статусом.
        if (!wasActive && this.active) {
          this.startHeartbeat();
        } else if (wasActive && !this.active) {
          this.stopHeartbeat();
        }

        if (this.active) {
          this.options.onActive?.();
        } else {
          this.options.onBlocked?.();
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', this.messageHandler);

    console.log('[SingleTab] Message listener added');
  }

  /**
   * Removes the message listener previously attached to the service worker.
   */
  private removeMessageListener(): void {
    if (this.messageHandler) {
      navigator.serviceWorker.removeEventListener('message', this.messageHandler);

      this.messageHandler = null;
    }
  }

  /**
   * Asks the service worker whether this tab is active and resolves once
   * the answer has been received and local state has been updated.
   */
  private requestAmIActive(): Promise<void> {
    return new Promise((resolve) => {
      const controller = navigator.serviceWorker.controller;

      console.log('[SingleTab] requestAmIActive: controller=', !!controller, 'tabId=', this.tabId);

      if (!controller) {
        console.warn('[SingleTab] requestAmIActive: no controller, cannot send message');

        this.options.onBlocked?.();

        resolve();

        return;
      }

      const handler = (event: MessageEvent) => {
        const data = event.data as { type?: string; active?: boolean };

        if (data?.type === EVENTS.AM_I_ACTIVE) {
          navigator.serviceWorker.removeEventListener('message', handler);

          this.active = data.active === true;

          console.log('[SingleTab] requestAmIActive response: active=', this.active);

          if (this.active) {
            this.options.onActive?.();
          } else {
            this.options.onBlocked?.();
          }

          resolve();
        }
      };

      navigator.serviceWorker.addEventListener('message', handler);

      controller.postMessage({
        type: EVENTS.AM_I_ACTIVE,
        tabId: this.tabId,
      });

      console.log(`[SingleTab] requestAmIActive: postMessage(${EVENTS.AM_I_ACTIVE}) sent`);
    });
  }

  /**
   * Starts periodic heartbeat messages to the service worker while this
   * tab is active, informing it that the tab is still alive.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    console.log('[SingleTab] startHeartbeat, interval=', this.options.heartbeatInterval);

    this.heartbeatTimer = setInterval(() => {
      navigator.serviceWorker.controller?.postMessage({
        type: EVENTS.PING,
        tabId: this.tabId,
      });
    }, this.options.heartbeatInterval);
  }

  /**
   * Stops sending heartbeat messages to the service worker.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);

      this.heartbeatTimer = null;
    }
  }
}
