/**
 * Durable tick state for daily volume and cooldown checks (Slice E prep).
 *
 * Uses Upstash Redis REST when configured; otherwise in-memory (local/tests).
 * Store errors fail closed — callers must treat as gate failure / no-plan.
 */

import {
  getAgent1TickStore,
  getUtcDayKey,
  resetInMemoryTickStoreForTests,
  setTickStoreForTests,
  TickStoreError,
  type Agent1TickStore,
  type PersistedTickState,
} from "@/lib/agent1/tick-state-store";

export type { Agent1TickStore, PersistedTickState };
export {
  getAgent1TickStore,
  getTickStoreMeta,
  getUtcDayKey,
  resetInMemoryTickStoreForTests,
  setTickStoreForTests,
  TickStoreError,
} from "@/lib/agent1/tick-state-store";

export interface Agent1TickStateSnapshot {
  dailyVolumeUsedUsdc: number;
  dailyVolumeDayUtc: string;
  lastPlannedAtMs: number | null;
}

export type TickStateOk<T> = { ok: true; data: T };
export type TickStateErr = {
  ok: false;
  reason: "tick_store_error";
  message: string;
};
export type TickStateResult<T> = TickStateOk<T> | TickStateErr;

function rolloverIfNeeded(state: PersistedTickState, now = new Date()): PersistedTickState {
  const day = getUtcDayKey(now);
  if (day !== state.dailyVolumeDayUtc) {
    return {
      dailyVolumeUsedUsdc: 0,
      dailyVolumeDayUtc: day,
      lastPlannedAtMs: state.lastPlannedAtMs,
    };
  }
  return state;
}

async function withStore<T>(
  fn: (state: PersistedTickState, store: Agent1TickStore) => Promise<{ state: PersistedTickState; result: T }>,
): Promise<TickStateResult<T>> {
  const store = getAgent1TickStore();
  try {
    const state = rolloverIfNeeded(await store.load());
    const { state: nextState, result } = await fn(state, store);
    if (nextState !== state) {
      await store.save(nextState);
    }
    return { ok: true, data: result };
  } catch (error) {
    const message =
      error instanceof TickStoreError
        ? error.message
        : error instanceof Error
          ? error.message
          : "tick_store_error";
    return { ok: false, reason: "tick_store_error", message };
  }
}

export async function getTickStateSnapshot(): Promise<TickStateResult<Agent1TickStateSnapshot>> {
  const store = getAgent1TickStore();
  try {
    const state = rolloverIfNeeded(await store.load());
    return {
      ok: true,
      data: {
        dailyVolumeUsedUsdc: state.dailyVolumeUsedUsdc,
        dailyVolumeDayUtc: state.dailyVolumeDayUtc,
        lastPlannedAtMs: state.lastPlannedAtMs,
      },
    };
  } catch (error) {
    const message =
      error instanceof TickStoreError
        ? error.message
        : error instanceof Error
          ? error.message
          : "tick_store_error";
    return { ok: false, reason: "tick_store_error", message };
  }
}

export async function checkDailyVolumeCapacity(
  amountUsdc: number,
  dailyLimitUsdc: number,
  now = new Date(),
): Promise<
  TickStateResult<
    | { ok: true; remainingUsdc: number }
    | { ok: false; reason: "daily_volume_exceeded"; usedUsdc: number; limitUsdc: number }
  >
> {
  return withStore<
    | { ok: true; remainingUsdc: number }
    | { ok: false; reason: "daily_volume_exceeded"; usedUsdc: number; limitUsdc: number }
  >(async (state) => {
    const rolled = rolloverIfNeeded(state, now);
    const remainingUsdc = Math.max(0, dailyLimitUsdc - rolled.dailyVolumeUsedUsdc);

    if (amountUsdc > remainingUsdc) {
      return {
        state: rolled,
        result: {
          ok: false as const,
          reason: "daily_volume_exceeded" as const,
          usedUsdc: rolled.dailyVolumeUsedUsdc,
          limitUsdc: dailyLimitUsdc,
        },
      };
    }

    return {
      state: rolled,
      result: { ok: true as const, remainingUsdc },
    };
  });
}

export async function checkCooldown(
  cooldownSeconds: number,
  nowMs = Date.now(),
): Promise<
  TickStateResult<
    { ok: true } | { ok: false; reason: "cooldown_active"; remainingSeconds: number }
  >
> {
  return withStore<
    { ok: true } | { ok: false; reason: "cooldown_active"; remainingSeconds: number }
  >(async (state) => {
    const rolled = rolloverIfNeeded(state);

    if (cooldownSeconds <= 0 || rolled.lastPlannedAtMs === null) {
      return { state: rolled, result: { ok: true as const } };
    }

    const elapsedSeconds = (nowMs - rolled.lastPlannedAtMs) / 1000;
    if (elapsedSeconds >= cooldownSeconds) {
      return { state: rolled, result: { ok: true as const } };
    }

    return {
      state: rolled,
      result: {
        ok: false as const,
        reason: "cooldown_active" as const,
        remainingSeconds: Math.ceil(cooldownSeconds - elapsedSeconds),
      },
    };
  });
}

/** Records a planned (not broadcast) dry-run amount for daily volume tracking. */
export async function recordPlannedDryRun(
  amountUsdc: number,
  now = new Date(),
): Promise<TickStateResult<Agent1TickStateSnapshot>> {
  return withStore(async (state) => {
    const rolled = rolloverIfNeeded(state, now);
    const next: PersistedTickState = {
      dailyVolumeUsedUsdc: rolled.dailyVolumeUsedUsdc + amountUsdc,
      dailyVolumeDayUtc: rolled.dailyVolumeDayUtc,
      lastPlannedAtMs: now.getTime(),
    };
    return {
      state: next,
      result: {
        dailyVolumeUsedUsdc: next.dailyVolumeUsedUsdc,
        dailyVolumeDayUtc: next.dailyVolumeDayUtc,
        lastPlannedAtMs: next.lastPlannedAtMs,
      },
    };
  });
}

/** Test-only reset — not for production use. */
export async function resetTickStateForTests(): Promise<void> {
  setTickStoreForTests(null);
  resetInMemoryTickStoreForTests();
  const store = getAgent1TickStore();
  const day = getUtcDayKey();
  await store.save({
    dailyVolumeUsedUsdc: 0,
    dailyVolumeDayUtc: day,
    lastPlannedAtMs: null,
  });
}
