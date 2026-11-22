/**
 * The voyage's memory in the browser (localStorage): the seed, the crew, the chart, the lands found, the bottles read.
 * Where there is no storage at all (the build tools load the game's modules in node) nothing is kept, quietly; where
 * the browser refuses it (a private window, a full quota) the game forgets between sessions and says so once. What is
 * read back is checked before it is used: a value of the wrong shape is reported and left out.
 */

let refused = false;

function refuse(action: string, key: string, error: unknown): void {
  if (refused) return;
  refused = true;
  console.warn(`Paper Seas: the browser refused to ${action} "${key}"; the voyage will not be remembered.`, error);
}

// (with site data blocked, even reaching localStorage throws)
const store: Storage | null = (() => {
  try {
    return globalThis.localStorage ?? null;
  } catch (error) {
    refuse('open', 'localStorage', error);
    return null;
  }
})();

export function loadText(key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch (error) {
    refuse('read', key, error);
    return null;
  }
}

export function saveText(key: string, value: string): void {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch (error) {
    refuse('save', key, error);
  }
}

export function forget(key: string): void {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch (error) {
    refuse('clear', key, error);
  }
}

/** The stored JSON value of key if it has the shape valid checks, else null (a bad value is reported). */
export function loadJson<T>(key: string, valid: (value: unknown) => value is T): T | null {
  const raw = loadText(key);
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    console.warn(`Paper Seas: the stored "${key}" is not JSON; it is ignored.`, error);
    return null;
  }
  if (valid(value)) return value;
  console.warn(`Paper Seas: the stored "${key}" has an unexpected shape; it is ignored.`);
  return null;
}

export function saveJson(key: string, value: unknown): void {
  saveText(key, JSON.stringify(value));
}

/** Shape checks for loadJson. */
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isString = (v: unknown): v is string => typeof v === 'string';
export const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNumber);
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
