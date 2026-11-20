import type { runNode } from './node';
import type { runToken } from './token';

export const TIMEOUT = 2000;

export type Outcome<T> = { ok: true; result: T } | { ok: false; reason: 'timeout' | 'crash'; message?: string };

function run<T>(kind: 'node' | 'token', args: unknown[]): Promise<Outcome<T>> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const done = (outcome: Outcome<T>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(outcome);
    };
    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), TIMEOUT);
    worker.onmessage = (event) => done({ ok: true, result: event.data as T });
    worker.onerror = (event) => {
      event.preventDefault();
      done({ ok: false, reason: 'crash', message: event.message });
    };
    worker.postMessage({ kind, args });
  });
}

export const sandboxNode = (...args: Parameters<typeof runNode>) => run<ReturnType<typeof runNode>>('node', args);
export const sandboxToken = (...args: Parameters<typeof runToken>) => run<ReturnType<typeof runToken>>('token', args);
