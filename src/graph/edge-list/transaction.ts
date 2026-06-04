/**
 * Edge-store transaction primitive (Loop K2).
 *
 * Extracted from `base-store.ts` to keep that file under its layer budget.
 *
 * THE HAZARD: the bare `save()` lock (Loop LS-10, see `./lock`) serializes
 * only the inner write. But the in-process writers (toggle-watch,
 * refresh-graph, the server regenerator) do `load(); mutate(); save()` with
 * the LOAD *outside* the lock, so two of them can both load the same old
 * state, mutate independently, and the later save clobbers the earlier — a
 * lost update.
 *
 * `runEdgeStoreTransaction` acquires the per-file write lock ONCE and runs
 * `load → fn → saveLocked` inside the held section, so concurrent
 * transactions on the same file serialize: the second observes the first's
 * published state and neither mutation is lost.
 *
 * REENTRANCY CONTRACT: `load` and `saveLocked` passed here MUST NOT
 * re-acquire the same lock key, and `fn` MUST NOT call the public `save()` /
 * `withTransaction()` on a store over the same file. The queue in `./lock`
 * is NON-REENTRANT — a nested acquire of the same key would DEADLOCK. The
 * caller therefore wires the NON-locking `saveLocked` (not the public
 * `save`) and `load` is a pure read.
 */

import { withWriteLock } from './lock';

export async function runEdgeStoreTransaction<T>(
    lockKey: string,
    load: () => Promise<void>,
    saveLocked: () => Promise<void>,
    fn: () => T | Promise<T>,
): Promise<T> {
    return withWriteLock(lockKey, async () => {
        await load();
        const result = await fn();
        await saveLocked();
        return result;
    });
}
