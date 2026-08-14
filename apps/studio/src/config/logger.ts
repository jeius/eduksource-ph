import { createLogger as sharedCreateLogger } from '@eduksource/logger';
import { env } from './env.js';

const level = env.NODE_ENV === 'production' ? 'error' : 'debug';

export const logger = sharedCreateLogger({ level });

export function createLogger() {
  return sharedCreateLogger({ level });
}

export function createSilentLogger() {
  return sharedCreateLogger({ enabled: false });
}
