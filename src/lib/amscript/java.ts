/**
 * Small stand-ins for the Java objects that AM hands to scripts. Legacy scripts run on Rhino and see Java
 * collections and JsonValue; next-generation scripts see JavaScript values, with lists that still answer get().
 */

export type JavaList<T> = T[] & {
  get(index: number): T;
  size(): number;
  isEmpty(): boolean;
  contains(value: T): boolean;
  iterator(): JavaIterator<T>;
  toArray(): T[];
};

export interface JavaIterator<T> {
  hasNext(): boolean;
  next(): T;
}

function iterate<T>(values: T[]): JavaIterator<T> {
  let index = 0;
  return {
    hasNext: () => index < values.length,
    next: () => {
      if (index >= values.length) throw new Error('java.util.NoSuchElementException');
      return values[index++];
    },
  };
}

export function javaList<T>(values: T[]): JavaList<T> {
  const list = [...values] as JavaList<T>;
  const hidden = (name: string, value: unknown) => Object.defineProperty(list, name, { value, enumerable: false });
  hidden('get', (index: number) => {
    if (index < 0 || index >= list.length) throw new Error(`java.lang.IndexOutOfBoundsException: Index ${index} out of bounds for length ${list.length}`);
    return list[index];
  });
  hidden('size', () => list.length);
  hidden('isEmpty', () => list.length === 0);
  hidden('contains', (value: T) => list.includes(value));
  hidden('iterator', () => iterate([...list]));
  hidden('toArray', () => [...list]);
  return list;
}

/** A java.util.Set as Rhino shows it: no [index] access, and toString() prints [a, b]. */
export class JavaSet<T = string> {
  readonly #values: T[];

  constructor(values: Iterable<T> = []) {
    this.#values = [...new Set(values)];
  }

  iterator() {
    return iterate([...this.#values]);
  }
  toArray() {
    return [...this.#values];
  }
  size() {
    return this.#values.length;
  }
  isEmpty() {
    return this.#values.length === 0;
  }
  contains(value: T) {
    return this.#values.includes(value);
  }
  forEach(callback: (value: T) => void) {
    this.#values.forEach((value) => callback(value));
  }
  toString() {
    return `[${this.#values.join(', ')}]`;
  }
  toJSON() {
    return [...this.#values];
  }
}

/** org.forgerock.json.JsonValue, as legacy nodeState.get() returns it. */
export class JsonValue {
  readonly #value: unknown;

  constructor(value: unknown) {
    this.#value = value instanceof JsonValue ? value.getObject() : value;
  }

  static json(value: unknown) {
    return new JsonValue(value);
  }
  static array(...values: unknown[]) {
    return values;
  }
  static object(...fields: [string, unknown][]) {
    return Object.fromEntries(fields);
  }
  static field(key: string, value: unknown): [string, unknown] {
    return [key, value];
  }

  getObject() {
    return this.#value;
  }
  isNull() {
    return this.#value === null || this.#value === undefined;
  }
  isString() {
    return typeof this.#value === 'string';
  }
  asString() {
    return this.#value === null || this.#value === undefined ? null : String(this.#value);
  }
  asBoolean() {
    return Boolean(this.#value);
  }
  asInteger() {
    return Math.trunc(Number(this.#value));
  }
  asLong() {
    return Math.trunc(Number(this.#value));
  }
  asDouble() {
    return Number(this.#value);
  }
  asList() {
    return javaList(Array.isArray(this.#value) ? this.#value : []);
  }
  asMap() {
    return javaMap((this.#value as Record<string, unknown>) ?? {});
  }
  toString() {
    return JSON.stringify(this.#value);
  }
  toJSON() {
    return this.#value;
  }
}

export type JavaMap = Record<string, unknown> & {
  get(key: string): unknown;
  put(key: string, value: unknown): unknown;
  containsKey(key: string): boolean;
  keySet(): JavaSet<string>;
  size(): number;
};

export function javaMap(entries: Record<string, unknown>): JavaMap {
  const map = { ...entries } as JavaMap;
  const hidden = (name: string, value: unknown) => Object.defineProperty(map, name, { value, enumerable: false });
  hidden('get', (key: string) => (Object.hasOwn(map, key) ? map[key] : null));
  hidden('put', (key: string, value: unknown) => {
    const previous = Object.hasOwn(map, key) ? map[key] : null;
    map[key] = value;
    return previous;
  });
  hidden('containsKey', (key: string) => Object.hasOwn(map, key));
  hidden('keySet', () => new JavaSet(Object.keys(map)));
  hidden('size', () => Object.keys(map).length);
  return map;
}

/** A Java char[], as PasswordCallback.getPassword() returns it. JavaScript String() does not join it. */
export class CharArray {
  readonly #chars: string[];

  constructor(value: string) {
    this.#chars = [...value];
  }
  get length() {
    return this.#chars.length;
  }
  chars() {
    return [...this.#chars];
  }
  toString() {
    return '[C@6d06d69c';
  }
}

/** new java.lang.String(value): joins a char[] and leaves anything else as text. */
export function javaString(value: unknown): string {
  if (value instanceof CharArray) return value.chars().join('');
  return String(value);
}

/** Turns what a script produced into plain JSON values, so results can be shown and compared. */
export function plain(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof JsonValue) return plain(value.getObject());
  if (value instanceof JavaSet) return value.toArray().map(plain);
  if (value instanceof CharArray) return value.toString();
  if (value instanceof String) return value.valueOf();
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return [...value].map(plain);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, plain(item)]));
  }
  if (typeof value === 'function') return undefined;
  return value;
}
