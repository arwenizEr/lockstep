import { watch, existsSync, statSync, type FSWatcher } from "node:fs";

/**
 * Trailing debounce: collapse a burst of calls into one, fired `ms` after the
 * last call. Editors often emit several change events per save, so the run is
 * triggered once, not once per event. Pure of fs — unit-tested with fake timers.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

/**
 * Watch a set of files/directories and invoke `onChange` on any change.
 * Directories are watched recursively. Missing paths are skipped silently.
 * Returns a function that tears down all watchers.
 */
export function watchPaths(paths: string[], onChange: () => void): () => void {
  const watchers: FSWatcher[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const recursive = statSync(p).isDirectory();
      watchers.push(watch(p, { recursive }, () => onChange()));
    } catch {
      // A platform that rejects recursive watch, or a transient error — skip it.
    }
  }
  return () => {
    for (const w of watchers) w.close();
  };
}
