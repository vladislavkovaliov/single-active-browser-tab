import { ServiceWorkerStrategy, IServiceWorkerStrategyOptions, TabStrategy } from "./sw";

type StrategyType = "sw";

export interface SingleTabManagerOptions {
  onActive?: () => void;
  onBlocked?: () => void;
  swPath?: string;
  heartbeatInterval?: number;
}

export class SingleTabManager {
  protected readonly strategy: TabStrategy;

  private readonly strategies: Record<StrategyType, TabStrategy>;

  constructor(strategy: StrategyType = "sw", options?: SingleTabManagerOptions) {
    const opts: IServiceWorkerStrategyOptions = options ?? {};
    
    this.strategies = {
      sw: new ServiceWorkerStrategy({
        onActive: opts.onActive,
        onBlocked: opts.onBlocked,
        swPath: opts.swPath,
        heartbeatInterval: opts.heartbeatInterval,
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
    return this.strategy.isActive?.() ?? false;
  }

  /** Take over as the active tab; other tabs will receive onBlocked. */
  takeover(): void {
    this.strategy.takeover?.();
  }
}
