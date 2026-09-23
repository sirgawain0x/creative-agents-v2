import { logger } from "@/lib/logger";

const TICK_STATE_KEY = "agent1:tick:state";

export interface PersistedTickState {
  dailyVolumeUsedUsdc: number;
  dailyVolumeDayUtc: string;
  lastPlannedAtMs: number | null;
}

export interface Agent1TickStore {
  readonly backend: "upstash" | "memory";
  readonly persistent: boolean;
  load(): Promise<PersistedTickState>;
  save(state: PersistedTickState): Promise<void>;
}

export class TickStoreError extends Error {
  readonly reason = "tick_store_error" as const;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TickStoreError";
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

function emptyState(dayUtc: string): PersistedTickState {
  return {
    dailyVolumeUsedUsdc: 0,
    dailyVolumeDayUtc: dayUtc,
    lastPlannedAtMs: null,
  };
}

function parsePersistedState(raw: string | null, dayUtc: string): PersistedTickState {
  if (!raw) {
    return emptyState(dayUtc);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedTickState>;
    const day = typeof parsed.dailyVolumeDayUtc === "string" ? parsed.dailyVolumeDayUtc : dayUtc;
    const volume =
      typeof parsed.dailyVolumeUsedUsdc === "number" && Number.isFinite(parsed.dailyVolumeUsedUsdc)
        ? Math.max(0, parsed.dailyVolumeUsedUsdc)
        : 0;
    const lastPlannedAtMs =
      parsed.lastPlannedAtMs === null || parsed.lastPlannedAtMs === undefined
        ? null
        : typeof parsed.lastPlannedAtMs === "number" && Number.isFinite(parsed.lastPlannedAtMs)
          ? parsed.lastPlannedAtMs
          : null;

    if (day !== dayUtc) {
      return emptyState(dayUtc);
    }

    return {
      dailyVolumeUsedUsdc: volume,
      dailyVolumeDayUtc: dayUtc,
      lastPlannedAtMs,
    };
  } catch {
    return emptyState(dayUtc);
  }
}

class InMemoryTickStore implements Agent1TickStore {
  readonly backend = "memory" as const;
  readonly persistent = false;
  private state: PersistedTickState | null = null;

  async load(): Promise<PersistedTickState> {
    const dayUtc = getUtcDayKey();
    if (!this.state || this.state.dailyVolumeDayUtc !== dayUtc) {
      this.state = emptyState(dayUtc);
    }
    return { ...this.state };
  }

  async save(state: PersistedTickState): Promise<void> {
    this.state = { ...state };
  }

  resetForTests(): void {
    this.state = null;
  }
}

class UpstashRestTickStore implements Agent1TickStore {
  readonly backend = "upstash" as const;
  readonly persistent = true;

  constructor(
    private readonly restUrl: string,
    private readonly restToken: string,
  ) {}

  private async command(args: string[]): Promise<unknown> {
    const response = await fetch(this.restUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.restToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      throw new TickStoreError(`Upstash HTTP ${response.status}`);
    }

    const body = (await response.json()) as { result?: unknown; error?: string };
    if (body.error) {
      throw new TickStoreError(body.error);
    }

    return body.result;
  }

  async load(): Promise<PersistedTickState> {
    const dayUtc = getUtcDayKey();
    try {
      const result = await this.command(["GET", TICK_STATE_KEY]);
      const raw = typeof result === "string" ? result : null;
      return parsePersistedState(raw, dayUtc);
    } catch (error) {
      logger.error("tick_store_load_failed", {
        backend: this.backend,
        message: error instanceof Error ? error.message : "unknown",
      });
      throw error instanceof TickStoreError
        ? error
        : new TickStoreError("Failed to load tick state", error);
    }
  }

  async save(state: PersistedTickState): Promise<void> {
    try {
      await this.command(["SET", TICK_STATE_KEY, JSON.stringify(state)]);
    } catch (error) {
      logger.error("tick_store_save_failed", {
        backend: this.backend,
        message: error instanceof Error ? error.message : "unknown",
      });
      throw error instanceof TickStoreError
        ? error
        : new TickStoreError("Failed to save tick state", error);
    }
  }
}

const memoryStore = new InMemoryTickStore();
let storeOverride: Agent1TickStore | null = null;

export function getUtcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function httpsUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed?.startsWith("https://")) {
    return undefined;
  }
  return trimmed;
}

/**
 * Prefer explicit Upstash REST env. The Vercel Upstash integration injects the
 * same credentials as KV_REST_API_URL / KV_REST_API_TOKEN.
 */
function resolveUpstashRestCredentials(): { url: string; token: string } | undefined {
  const upstashUrl = httpsUrl(process.env.UPSTASH_REDIS_REST_URL);
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (upstashUrl && upstashToken) {
    return { url: upstashUrl, token: upstashToken };
  }

  const kvUrl = httpsUrl(process.env.KV_REST_API_URL);
  const kvToken = process.env.KV_REST_API_TOKEN?.trim();
  if (kvUrl && kvToken) {
    return { url: kvUrl, token: kvToken };
  }

  return undefined;
}

function createDefaultStore(): Agent1TickStore {
  const credentials = resolveUpstashRestCredentials();
  if (credentials) {
    return new UpstashRestTickStore(credentials.url, credentials.token);
  }

  return memoryStore;
}

export function getAgent1TickStore(): Agent1TickStore {
  return storeOverride ?? createDefaultStore();
}

/** Test-only: inject a mock store or reset to default factory. */
export function setTickStoreForTests(store: Agent1TickStore | null): void {
  storeOverride = store;
}

/** Test-only: reset the process-local in-memory fallback. */
export function resetInMemoryTickStoreForTests(): void {
  memoryStore.resetForTests();
}

export function getTickStoreMeta(): Pick<Agent1TickStore, "backend" | "persistent"> {
  const store = getAgent1TickStore();
  return { backend: store.backend, persistent: store.persistent };
}
