export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, nextAttempt: number, delayMs: number) => void | Promise<void>;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 5_000);
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error, attempt)) throw error;

      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential * 0.25)));
      const delayMs = Math.min(maxDelayMs, exponential + jitter);

      await options.onRetry?.(error, attempt + 1, delayMs);
      await delay(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
