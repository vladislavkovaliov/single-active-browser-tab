import { ServiceWorkerStrategy, TabStrategy } from './sw';
import { BroadcastChannelStrategy } from './broadcast';
import type { IServiceWorkerStrategyOptions } from './sw/types';

type StrategyType = 'sw' | 'broadcast';

export interface SingleTabManagerOptions {
  onActive?: () => void;
  onBlocked?: () => void;
  swPath?: string;
  heartbeatInterval?: number;
  staleTimeout?: number;
}

export class SingleTabManager {
  protected readonly strategy: TabStrategy;

  private readonly strategies: Record<StrategyType, TabStrategy>;

  constructor(strategy: StrategyType = 'sw', options?: SingleTabManagerOptions) {
    const opts: IServiceWorkerStrategyOptions = options ?? {};
    this.strategies = {
      sw: new ServiceWorkerStrategy({
        onActive: opts.onActive,
        onBlocked: opts.onBlocked,
        swPath: opts.swPath,
        heartbeatInterval: opts.heartbeatInterval,
      }),
      broadcast: new BroadcastChannelStrategy({
        onActive: opts.onActive,
        onBlocked: opts.onBlocked,
        heartbeatInterval: opts.heartbeatInterval,
        staleTimeout: opts.staleTimeout,
      }),
    };

    this.strategy = this.strategies[strategy]!;
  }

  start(): void {
    this.strategy.start();
  }

  stop(): void {
    this.strategy.stop();
  }

  isActive(): boolean {
    // console.log(this.strategy.isActive?.())
    return this.strategy.isActive?.() ?? false;
  }

  /** Take over as the active tab; other tabs will receive onBlocked. */
  takeover(): void {
    this.strategy.takeover?.();
  }
}
