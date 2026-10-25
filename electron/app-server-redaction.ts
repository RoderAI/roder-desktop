const secretKeyPattern = /(api[_-]?key|secret|password|authorization|(access|refresh|id)[_-]?token)/i;

/**
 * Returns a copy of `value` with every secret-looking field replaced. Used before app-server request
 * params are recorded for diagnostics, so API keys never sit in the event history that panels read.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        secretKeyPattern.test(key) ? "[redacted]" : redactSecrets(entry),
      ]),
    );
  }
  return value;
}
