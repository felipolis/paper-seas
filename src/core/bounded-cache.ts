/**
 * A memo for the pure functions of the seed the world is worked out from (its islands, streams, sites, roads...).
 * The world never ends, so it keeps at most `cap` answers: past that the oldest one is forgotten (a Map keeps its
 * insertion order) and worked out again, the same, if it is ever asked for again. The default is generous, many times
 * what one view of the world asks for, so an answer in use is only worked out again after thousands of newer ones.
 * Nothing may tell two answers apart by identity: one worked out again is equal to the first, not the same object.
 */
export class BoundedCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly cap = 4096) {}

  /** The answer for key: the remembered one, or make()'s, remembered from now on. */
  get(key: K, make: () => V): V {
    const known = this.map.get(key);
    if (known !== undefined || this.map.has(key)) return known as V;
    const value = make();
    this.map.set(key, value);
    if (this.map.size > this.cap) this.map.delete(this.map.keys().next().value as K);
    return value;
  }
}
