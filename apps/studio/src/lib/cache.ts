import { createHash } from 'node:crypto';
import type { ExtractResponse } from '../schemas/extract.js';

export class ExtractionCache {
  private map = new Map<string, ExtractResponse>();

  async hashFile(buffer: Uint8Array): Promise<string> {
    return createHash('sha256').update(buffer).digest('hex');
  }

  get(hash: string): ExtractResponse | undefined {
    return this.map.get(hash);
  }

  set(hash: string, value: ExtractResponse): void {
    this.map.set(hash, value);
  }

  clear(): void {
    this.map.clear();
  }
}

export const extractionCache = new ExtractionCache();
