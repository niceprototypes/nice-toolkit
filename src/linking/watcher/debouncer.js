/**
 * @fileoverview Keyed debouncer factory used by the watcher orchestrator
 */

/**
 * Creates a keyed debouncer that batches calls by key
 *
 * @param {number} delay - Debounce delay in milliseconds
 * @returns {{ call: (key: string, fn: (count: number) => void) => void }}
 */
function createKeyedDebouncer(delay) {
  const timers = new Map();
  const counts = new Map();

  return {
    call(key, fn) {
      counts.set(key, (counts.get(key) || 0) + 1);

      const existing = timers.get(key);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        const count = counts.get(key) || 1;
        timers.delete(key);
        counts.delete(key);
        fn(count);
      }, delay);

      timers.set(key, timer);
    },
  };
}

module.exports = {
  createKeyedDebouncer,
};
