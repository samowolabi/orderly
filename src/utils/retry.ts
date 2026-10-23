// Runs an async call up to `attempts` times, waiting `delayMs` between tries, and throws
// the last error. Only errors that `retryOn` accepts are retried. Use it only for calls
// that are safe to repeat.
export async function retry<T>(
  operation: () => Promise<T>,
  { attempts = 3, delayMs = 500, retryOn = () => true }: { attempts?: number; delayMs?: number; retryOn?: (error: unknown) => boolean } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !retryOn(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
