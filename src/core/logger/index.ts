import { Logger } from 'wi-console-logger';

function resolveLogLevel(): 'error' | 'warn' | 'log' {
  const raw =
    typeof process !== 'undefined' && process.env
      ? (process.env.LOG_LEVEL ?? process.env.VITE_LOG_LEVEL)
      : undefined;
  if (raw === 'warn' || raw === 'log' || raw === 'error') {
    return raw;
  }
  return 'error';
}

let instance: Logger | undefined = undefined;

export function getLoggerInstance() {
  if (instance) {
    return instance;
  } else {
    instance = new Logger({
      level: resolveLogLevel(),
      transform: {
        colors: {
          log: { background: 'white', font: 'black' },
          warn: { background: 'orange', font: 'black' },
          error: { background: 'red', font: 'black' },
        },
      },
    });

    return instance;
  }
}
