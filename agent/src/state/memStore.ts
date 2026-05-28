/**
 * memStore.ts
 * -----------
 * Minimal in-memory key-value store that implements the ioredis API subset
 * used by the Karma agent.
 *
 * Activated automatically when REDIS_URL is not set.
 * State is ephemeral — it is reset on every process restart — which is
 * acceptable for short-lived deployments (hackathon demos, CI).
 *
 * Supports:
 *   ping / connect / quit
 *   get / set (with EX, PX, NX options) / del
 *   mget
 *   scan (MATCH + COUNT)
 */

interface Entry {
  value: string;
  expiresAt?: number; // Date.now() milliseconds — undefined = no expiry
}

export class MemStore {
  private readonly data = new Map<string, Entry>();

  // ── ioredis event-emitter stub ────────────────────────────────────────────
  on(_event: string, _handler: unknown): this { return this; }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  async connect(): Promise<void> { /* no-op */ }
  async quit():    Promise<void> { /* no-op */ }

  async ping(): Promise<"PONG"> { return "PONG"; }

  // ── get ───────────────────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  // ── set ───────────────────────────────────────────────────────────────────
  // Supports option strings: "EX" <secs>, "PX" <ms>, "NX"

  async set(
    key:     string,
    value:   string,
    ...rest: unknown[]
  ): Promise<"OK" | null> {
    let ttlMs: number | undefined;
    let nx = false;

    for (let i = 0; i < rest.length; i++) {
      const opt = rest[i];
      if      (opt === "EX")  { ttlMs = Number(rest[++i]) * 1_000; }
      else if (opt === "PX")  { ttlMs = Number(rest[++i]); }
      else if (opt === "NX")  { nx    = true; }
    }

    if (nx) {
      const existing = await this.get(key);
      if (existing !== null) return null; // key exists → NX refuses write
    }

    this.data.set(key, {
      value,
      expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : undefined,
    });
    return "OK";
  }

  // ── del ───────────────────────────────────────────────────────────────────

  async del(key: string): Promise<number> {
    return this.data.delete(key) ? 1 : 0;
  }

  // ── mget ──────────────────────────────────────────────────────────────────

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map((k) => this.get(k)));
  }

  // ── scan ──────────────────────────────────────────────────────────────────
  // Single-shot implementation: returns ALL matching keys when cursor is "0",
  // then signals completion with cursor "0" (i.e. one iteration is enough).

  async scan(
    cursor:     string,
    _matchFlag: "MATCH",
    pattern:    string,
    _countFlag: "COUNT",
    _count:     number,
  ): Promise<[string, string[]]> {
    if (cursor !== "0") return ["0", []];

    const regex = globToRegex(pattern);
    const now   = Date.now();
    const keys: string[] = [];

    for (const [key, entry] of this.data) {
      if (entry.expiresAt !== undefined && now > entry.expiresAt) {
        this.data.delete(key);
        continue;
      }
      if (regex.test(key)) keys.push(key);
    }

    return ["0", keys];
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Converts a Redis glob-style pattern (with * and ?) into a RegExp. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
