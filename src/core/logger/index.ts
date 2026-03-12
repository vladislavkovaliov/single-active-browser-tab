import { Logger } from 'wi-console-logger';

let instance: Logger | undefined = undefined;

export function getLoggerInstance() {
  if (instance) {
    return instance;
  } else {
    instance = new Logger({
      level: import.meta.env.VITE_LOG_LEVEL as 'error' | 'warn' | 'log',
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
