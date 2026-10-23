// Retries an async operation with exponential backoff and jitter, within a time budget.
// Use it for calls that can fail for a moment (a provider's 5xx, a dropped connection),
// and only for calls that are safe to repeat.

export type RetryOptions = {
  // Total tries, including the first.
  attempts: number;
  // Wait before the second try; each later wait multiplies by `factor`, up to `maxDelayMs`.
  baseDelayMs: number;
  maxDelayMs?: number;
  factor?: number;
  // Waits a random time between 0 and the computed delay, so callers don't retry in step.
  jitter?: boolean;
  // Stops retrying when the next wait would end after this many ms from the first try.
  // Keeps a request under its caller's timeout (a Chord tool call, an HTTP client).
  budgetMs?: number;
  // Decides whether an error is worth another try. Defaults to retrying every error.
  retryOn?: (error: unknown, attempt: number) => boolean;
  // Called before each wait, e.g. to log the failed attempt.
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  // Replaceable for tests.
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The wait before try number `attempt + 1`, where `attempt` is the try that just failed (1-based).
export function backoffDelay(attempt: number, options: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "factor" | "jitter" | "random">) {
  const { baseDelayMs, maxDelayMs = Infinity, factor = 2, jitter = true, random = Math.random } = options;
  const delay = Math.min(maxDelayMs, baseDelayMs * factor ** (attempt - 1));
  return Math.round(jitter ? random() * delay : delay);
}

// Runs `operation` until it succeeds, an error isn't retryable, the tries run out or the
// budget would be passed. Throws the last error. `operation` gets the 1-based try number.
export async function retry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, budgetMs, retryOn = () => true, onRetry, sleep = wait, now = Date.now } = options;
  if (attempts < 1) throw new RangeError("retry needs at least one attempt");
  const started = now();

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= attempts || !retryOn(error, attempt)) throw error;
      const delay = backoffDelay(attempt, options);
      if (budgetMs !== undefined && now() - started + delay >= budgetMs) throw error;
      onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
}
