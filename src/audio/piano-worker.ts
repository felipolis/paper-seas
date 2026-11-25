/// <reference lib="webworker" />
/**
 * Synthesises the piano's notes off the main thread (each takes 10-20 ms of maths), one message per note, its samples
 * handed over without a copy; the music starts once every note has come (music.ts).
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
