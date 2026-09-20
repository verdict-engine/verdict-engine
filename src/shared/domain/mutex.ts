/**
 * Serializes async critical sections that read-modify-write shared state. Projectors fold
 * an event into a stored doc (load → apply → save); with an async store the load/save gap
 * lets a concurrent event interleave and clobber the update. Running each fold through this
 * mutex removes the gap without blocking the whole event bus (which nested publishes make
 * deadlock-prone). A failed section never blocks the next.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
