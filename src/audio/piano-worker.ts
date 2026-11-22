/// <reference lib="webworker" />
/**
 * Synthesises the piano's notes off the main thread (each takes 10-20 ms of maths), one message per note so the
 * music can start with the first ones while the rest are still being made.
 */
import { synthNote } from './piano-synth';

// (this module runs as a dedicated worker, not in the page the DOM types describe)
declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<number[]>) => {
  for (const midi of e.data) {
    const samples = synthNote(midi);
    self.postMessage({ midi, samples }, [samples.buffer]);
  }
};
