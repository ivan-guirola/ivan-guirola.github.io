import { runNode } from './node';
import { runToken } from './token';

/** Runs one script away from the page: a fresh worker per run, so a script can't touch the page or the next run. */
self.onmessage = (event: MessageEvent) => {
  const { kind, args } = event.data;
  const result = kind === 'node' ? runNode(...(args as Parameters<typeof runNode>)) : runToken(...(args as Parameters<typeof runToken>));
  self.postMessage(JSON.parse(JSON.stringify(result)));
};
