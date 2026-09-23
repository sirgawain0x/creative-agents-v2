/**
 * Process-scoped tick state for daily volume and cooldown checks.
 *
 * Slice D uses in-memory state only (no broadcast, no durable ledger).
 * Serverless cold starts reset counters — Slice E should add persistent storage
 * before live execute.
 */

export interface Agent1TickStateSnapshot {
  dailyVolumeUsedUsdc: number;
  dailyVolumeDayUtc: string;
  lastPlannedAtMs: number | null;
}

let dailyVolumeUsedUsdc = 0;
let dailyVolumeDayUtc = getUtcDayKey();
let lastPlannedAtMs: number | null = null;

function getUtcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function rolloverDailyVolumeIfNeeded(now = new Date()): void {
  const day = getUtcDayKey(now);
  if (day !== dailyVolumeDayUtc) {
    dailyVolumeUsedUsdc = 0;
    dailyVolumeDayUtc = day;
  }
}

export function getTickStateSnapshot(): Agent1TickStateSnapshot {
  rolloverDailyVolumeIfNeeded();
  return {
    dailyVolumeUsedUsdc,
    dailyVolumeDayUtc,
    lastPlannedAtMs,
  };
}

export function checkDailyVolumeCapacity(
  amountUsdc: number,
  dailyLimitUsdc: number,
  now = new Date(),
): { ok: true; remainingUsdc: number } | { ok: false; reason: "daily_volume_exceeded"; usedUsdc: number; limitUsdc: number } {
  rolloverDailyVolumeIfNeeded(now);

  const remainingUsdc = Math.max(0, dailyLimitUsdc - dailyVolumeUsedUsdc);
  if (amountUsdc > remainingUsdc) {
    return {
      ok: false,
      reason: "daily_volume_exceeded",
      usedUsdc: dailyVolumeUsedUsdc,
      limitUsdc: dailyLimitUsdc,
    };
  }

  return { ok: true, remainingUsdc };
}

export function checkCooldown(
  cooldownSeconds: number,
  nowMs = Date.now(),
): { ok: true } | { ok: false; reason: "cooldown_active"; remainingSeconds: number } {
  if (cooldownSeconds <= 0 || lastPlannedAtMs === null) {
    return { ok: true };
  }

  const elapsedSeconds = (nowMs - lastPlannedAtMs) / 1000;
  if (elapsedSeconds >= cooldownSeconds) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: "cooldown_active",
    remainingSeconds: Math.ceil(cooldownSeconds - elapsedSeconds),
  };
}

/** Records a planned (not broadcast) dry-run amount for daily volume tracking. */
export function recordPlannedDryRun(amountUsdc: number, now = new Date()): void {
  rolloverDailyVolumeIfNeeded(now);
  dailyVolumeUsedUsdc += amountUsdc;
  lastPlannedAtMs = now.getTime();
}

/** Test-only reset — not for production use. */
export function resetTickStateForTests(): void {
  dailyVolumeUsedUsdc = 0;
  dailyVolumeDayUtc = getUtcDayKey();
  lastPlannedAtMs = null;
}
