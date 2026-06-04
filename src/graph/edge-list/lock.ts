/**
 * In-process write serialization for edge-list saves (Loop 14 extraction of
 * `graph/edgelist.ts`).
 *
 * SAME-PROCESS LOST UPDATES — within one serve process multiple async
 * writers (file-watcher, arch regenerator, viewer toggle-watch, on-demand
 * refresh) run `load → mutate → save`. Because each step awaits, two writers
 * can interleave and the later `save` clobbers the earlier writer's
 * mutation. Atomic temp+rename does NOT help here — both writes are
 * individually complete. `withWriteLock` chains each save onto a per-key
 * promise so the critical sections are serialized.
 *
 * CROSS-PROCESS LOST UPDATES (two serve processes / a CLI scan racing the
 * extension) remain DEFERRED to a future OS lockfile. This in-process mutex
 * only covers writers living in the same Node process.
 */

/**
 * Per-key promise chain implementing a tiny, dependency-free, in-process
 * async mutex (single-flight queue). Each `withWriteLock(key, fn)` chains
 * `fn` after the previous task for that key, so callers targeting the same
 * file run their `load → mutate → save` critical sections one at a time.
 *
 * Keyed by the absolute target path so all stores writing the SAME file in
 * this process serialize, while writes to different files stay concurrent.
 *
 * NON-REENTRANT: only the top-level `save()` routes through this. A save
 * triggered from inside an already-held section would deadlock, so nested
 * helpers must never re-acquire the same key.
 *
 * Exported so a caller that wants its ENTIRE `load → mutate → save`
 * composition serialized (not just the inner save) can wrap that whole
 * sequence under the same key — but it must then NOT also call `save()`
 * (which re-acquires the key and would deadlock); use the store's mutate +
 * a direct write, or keep the composition outside and rely on save's own
 * lock. The edge stores use it only around `save`.
 */
const writeLocks = new Map<string, Promise<unknown>>();

export async function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = writeLocks.get(key) ?? Promise.resolve();
    // Chain regardless of whether `prev` rejected: a failed prior save must
    // not wedge the queue. `.catch` swallows the prior error here; the prior
    // caller already received its own rejection.
    const run = prev.catch(() => undefined).then(fn);
    // Store a never-rejecting tail so a failing `run` doesn't poison the
    // chain for the next waiter.
    const tail = run.catch(() => undefined);
    writeLocks.set(key, tail);
    // Once this task is the current tail and has settled, drop it from the
    // map so one-shot keys don't accumulate. If a newer save has already
    // replaced the tail, leave it alone.
    void tail.then(() => {
        if (writeLocks.get(key) === tail) {
            writeLocks.delete(key);
        }
    });
    return run;
}
