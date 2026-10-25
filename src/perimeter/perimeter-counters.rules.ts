interface CounterWindow {
  counterId: string;
  expiresAt: Date;
}

// WHY: windows aligned to the epoch, so every process counts a key into the same document for the same window.
export function toCounterWindow(key: string, windowSeconds: number, now: Date): CounterWindow {
  const windowMs = windowSeconds * 1000;
  const startedAtMs = Math.floor(now.getTime() / windowMs) * windowMs;
  return { counterId: `${key}@${new Date(startedAtMs).toISOString()}`, expiresAt: new Date(startedAtMs + windowMs) };
}
