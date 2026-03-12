import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// Custom mocks so we can inspect constructor calls and instances
jest.mock('./sw', () => {
  const ServiceWorkerStrategyMock = jest.fn().mockImplementation((options) => ({
    start: jest.fn(),
    stop: jest.fn(),
    isActive: jest.fn().mockReturnValue(false),
    takeover: jest.fn(),
    options,
  }));

  return { ServiceWorkerStrategy: ServiceWorkerStrategyMock };
});

jest.mock('./broadcast', () => {
  const BroadcastChannelStrategyMock = jest.fn().mockImplementation((options) => ({
    start: jest.fn(),
    stop: jest.fn(),
    isActive: jest.fn().mockReturnValue(false),
    takeover: jest.fn(),
    options,
  }));

  return { BroadcastChannelStrategy: BroadcastChannelStrategyMock };
});

import { SingleTabManager } from './single-tab-manager';
import { ServiceWorkerStrategy } from './sw';
import { BroadcastChannelStrategy } from './broadcast';

type StrategyMockInstance = {
  start: jest.Mock;
  stop: jest.Mock;
  isActive: jest.Mock;
  takeover: jest.Mock;
  options: any;
};

describe('SingleTabManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses ServiceWorkerStrategy by default and delegates start/stop to it', () => {
    const SwMock = ServiceWorkerStrategy as unknown as jest.Mock;
    const BcMock = BroadcastChannelStrategy as unknown as jest.Mock;

    const manager = new SingleTabManager();

    expect(SwMock).toHaveBeenCalledTimes(1);
    expect(BcMock).toHaveBeenCalledTimes(1);

    const swInstance = SwMock.mock.results[0].value as StrategyMockInstance;
    const bcInstance = BcMock.mock.results[0].value as StrategyMockInstance;

    // Strategy field should point to the SW instance by default
    // @ts-expect-error accessing protected for test
    expect(manager['strategy']).toBe(swInstance);

    manager.start();
    expect(swInstance.start).toHaveBeenCalled();
    expect(bcInstance.start).not.toHaveBeenCalled();

    manager.stop();
    expect(swInstance.stop).toHaveBeenCalled();
    expect(bcInstance.stop).not.toHaveBeenCalled();
  });

  it('uses BroadcastChannelStrategy when strategy is "broadcast" and delegates methods to it', () => {
    const SwMock = ServiceWorkerStrategy as unknown as jest.Mock;
    const BcMock = BroadcastChannelStrategy as unknown as jest.Mock;

    const manager = new SingleTabManager('broadcast');

    expect(SwMock).toHaveBeenCalledTimes(1);
    expect(BcMock).toHaveBeenCalledTimes(1);

    const swInstance = SwMock.mock.results[0].value as StrategyMockInstance;
    const bcInstance = BcMock.mock.results[0].value as StrategyMockInstance;

    // @ts-expect-error accessing protected for test
    expect(manager['strategy']).toBe(bcInstance);

    manager.start();
    expect(bcInstance.start).toHaveBeenCalled();
    expect(swInstance.start).not.toHaveBeenCalled();

    manager.stop();
    expect(bcInstance.stop).toHaveBeenCalled();
    expect(swInstance.stop).not.toHaveBeenCalled();
  });

  it('passes options correctly to ServiceWorkerStrategy', () => {
    const opts = {
      onActive: jest.fn(),
      onBlocked: jest.fn(),
      swPath: '/custom-sw.js',
      heartbeatInterval: 1234,
      staleTimeout: 9999,
    };

    new SingleTabManager('sw', opts);

    const SwMock = ServiceWorkerStrategy as unknown as jest.Mock;
    expect(SwMock).toHaveBeenCalledTimes(1);

    const swInstance = SwMock.mock.results[0].value as StrategyMockInstance;
    expect(swInstance.options).toEqual({
      onActive: opts.onActive,
      onBlocked: opts.onBlocked,
      swPath: opts.swPath,
      heartbeatInterval: opts.heartbeatInterval,
    });
  });

  it('passes options correctly to BroadcastChannelStrategy', () => {
    const opts = {
      onActive: jest.fn(),
      onBlocked: jest.fn(),
      heartbeatInterval: 4321,
      staleTimeout: 7777,
      swPath: '/ignored-sw.js',
    };

    new SingleTabManager('broadcast', opts);

    const BcMock = BroadcastChannelStrategy as unknown as jest.Mock;
    expect(BcMock).toHaveBeenCalledTimes(1);

    const bcInstance = BcMock.mock.results[0].value as StrategyMockInstance;
    expect(bcInstance.options).toEqual({
      onActive: opts.onActive,
      onBlocked: opts.onBlocked,
      heartbeatInterval: opts.heartbeatInterval,
      staleTimeout: opts.staleTimeout,
    });
  });

  it('isActive returns underlying strategy value when defined', () => {
    const manager = new SingleTabManager();
    const SwMock = ServiceWorkerStrategy as unknown as jest.Mock;
    const swInstance = SwMock.mock.results[0].value as StrategyMockInstance;

    swInstance.isActive.mockReturnValueOnce(true);
    expect(manager.isActive()).toBe(true);

    swInstance.isActive.mockReturnValueOnce(false);
    expect(manager.isActive()).toBe(false);
  });

  it('isActive returns false when strategy has no isActive method', () => {
    const manager = new SingleTabManager();

    // Replace internal strategy with one that lacks isActive
    // @ts-expect-error override for test
    manager['strategy'] = {
      start: jest.fn(),
      stop: jest.fn(),
    };

    expect(manager.isActive()).toBe(false);
  });

  it('takeover delegates to underlying strategy when available', () => {
    const manager = new SingleTabManager();
    const SwMock = ServiceWorkerStrategy as unknown as jest.Mock;
    const swInstance = SwMock.mock.results[0].value as StrategyMockInstance;

    manager.takeover();
    expect(swInstance.takeover).toHaveBeenCalled();
  });

  it('takeover does not throw when strategy has no takeover method', () => {
    const manager = new SingleTabManager();

    // Replace internal strategy with one that lacks takeover
    // @ts-expect-error override for test
    manager['strategy'] = {
      start: jest.fn(),
      stop: jest.fn(),
      isActive: jest.fn().mockReturnValue(true),
    };

    expect(() => manager.takeover()).not.toThrow();
  });
});


