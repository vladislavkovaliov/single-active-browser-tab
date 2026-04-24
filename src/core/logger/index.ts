import { Logger } from 'wi-console-logger';

function resolveLogLevel(logLevel?: 'error' | 'warn' | 'log'): 'error' | 'warn' | 'log' {
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

export function getLoggerInstance(logLevel?: 'error' | 'warn' | 'log') {
  if (instance) {
    return instance;
  } else {
    instance = new Logger({
      level: logLevel ? logLevel : resolveLogLevel(logLevel),
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
