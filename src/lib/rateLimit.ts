type Entry = { failures: number; resetAt: number };

// Kept on globalThis so hot reloads in development don't reset it
const globalForLimiter = globalThis as unknown as {
  loginFailures?: Map<string, Entry>;
};
const store = globalForLimiter.loginFailures ?? new Map<string, Entry>();
globalForLimiter.loginFailures = store;

export const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function sweep(now: number) {
  if (store.size < 1000) return;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

export function getLockStatus(key: string) {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) return { locked: false, retryAfterSeconds: 0 };
  if (entry.failures >= MAX_FAILURES) {
    return { locked: true, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export function recordFailure(key: string) {
  const now = Date.now();
  sweep(now);
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    store.set(key, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.failures += 1;
}

export function clearFailures(key: string) {
  store.delete(key);
}