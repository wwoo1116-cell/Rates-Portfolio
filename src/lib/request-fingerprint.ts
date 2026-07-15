import { hashKey } from "@tanstack/react-query";

/**
 * Short content fingerprint of a request object, for use in query keys in
 * place of the object itself.
 *
 * Why not just put the request in the key: TanStack re-hashes the whole key
 * (sorted JSON.stringify) on EVERY render to look the query up, and our
 * analytics requests carry all 686 positions (~290 KB). Measured: 3.4 ms per
 * hash, and Home renders hash 9 of them — ~31 ms of main-thread time per
 * render, before React does anything. With a fingerprint the per-render hash
 * is on a ~60-byte key (~1 µs); the expensive serialization runs once per
 * CONTENT CHANGE inside the caller's useMemo instead.
 *
 * Correctness is the whole game here — a stale key means silently serving
 * wrong data. Two properties carry it:
 *  - Same serialization as the status quo: hashKey() is the exact function
 *    TanStack applies to the key today (object-key-order insensitive), so
 *    anything that would have produced a different key before produces a
 *    different fingerprint now.
 *  - Collision guard: FNV-1a is 32-bit, so the serialized LENGTH rides along
 *    in the fingerprint, and callers additionally put positions.length in the
 *    key. A false cache hit needs a same-length, same-count 32-bit collision
 *    across the handful of distinct requests in one session's cache.
 *
 * Side benefit: a re-created object with identical content (store rehydration,
 * effect re-runs) used to be a NEW key — spurious refetch. Content addressing
 * makes it a cache hit instead.
 */
export function requestFingerprint(obj: unknown): string {
  const s = hashKey([obj]);
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return `${(h >>> 0).toString(36)}:${s.length}`;
}
