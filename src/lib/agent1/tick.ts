import { isDeniedMeToken } from "@/lib/agent1/deny-list";
import { dryRunUsdcToMeToken, type Agent1DryRunSuccess } from "@/lib/agent1/dry-run";
import {
  listSubscribedMeTokens,
  type SubscribedMeToken,
} from "@/lib/agent1/metokens-subgraph";
import {
  executeTradingNoOp,
  getTradingBroadcastEligibility,
  getAgent1Policy,
  type Agent1Policy,
} from "@/lib/agent1/policy";
import {
  getAgent1SignerStatus,
  sendPreparedAlchemyCalls,
} from "@/lib/agent1/signer";
import {
  checkCooldown,
  checkDailyVolumeCapacity,
  getTickStateSnapshot,
  recordPlannedDryRun,
  type Agent1TickStateSnapshot,
  type TickStateResult,
} from "@/lib/agent1/tick-state";
import {
  hasTickModelCredentials,
  isTickModelEnabled,
  selectCandidateWithModel,
} from "@/lib/agent1/tick-model";
import { validateMeTokenUniverse } from "@/lib/agent1/universe";
import { getAgent1VenueStatus } from "@/lib/agent1/venue";
import { logger } from "@/lib/logger";

export const DEFAULT_CANDIDATE_STRATEGY = "newest_subscribe_first" as const;

export type Agent1CandidateStrategy =
  | typeof DEFAULT_CANDIDATE_STRATEGY
  | "model_assisted";

export interface Agent1TickCandidate {
  meToken: string;
  symbol: string;
  name: string;
  hubId: string;
  selected: boolean;
  rejectReason?: string;
}

export interface Agent1TickBroadcast {
  attempted: boolean;
  ok: boolean;
  error?: string;
  message?: string;
  result?: unknown;
}

export interface Agent1TickSuccess {
  ok: true;
  agent: "agent1";
  slice: "E-live";
  wouldExecute: boolean;
  broadcast: boolean;
  timestamp: string;
  policy: Pick<Agent1Policy, "gates" | "limits" | "trading">;
  tickState: Agent1TickStateSnapshot | null;
  tickStoreError: string | null;
  decision: {
    action: "skipped" | "planned" | "executed";
    reason: string;
    candidateStrategy: Agent1CandidateStrategy;
    modelUsed: boolean;
    tradeUsdcAmount: string | null;
  };
  candidatesConsidered: Agent1TickCandidate[];
  dryRun: Agent1DryRunSuccess | null;
  broadcastAttempt: Agent1TickBroadcast | null;
  trading: {
    executed: boolean;
    reason: string;
  };
  warnings: string[];
}

export interface Agent1TickFailure {
  ok: false;
  agent: "agent1";
  slice: "E-live";
  wouldExecute: false;
  broadcast: false;
  error: string;
  message: string;
  status: number;
}

export type Agent1TickResult = Agent1TickSuccess | Agent1TickFailure;

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (!value?.trim()) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

function resolveCandidateStrategy(modelUsed: boolean): Agent1CandidateStrategy {
  if (modelUsed) {
    return "model_assisted";
  }
  return DEFAULT_CANDIDATE_STRATEGY;
}

async function resolveTradeUsdcAmount(policy: Agent1Policy): Promise<
  TickStateResult<{ amount: string; amountNumber: number }>
> {
  const maxTrade = policy.limits.maxTradeUsdc;
  const volumeCheck = await checkDailyVolumeCapacity(maxTrade, policy.limits.dailyVolumeUsdc);
  if (!volumeCheck.ok) {
    return volumeCheck;
  }

  const inner = volumeCheck.data;
  if (!inner.ok) {
    return { ok: true, data: { amount: "0", amountNumber: 0 } };
  }

  const amount = Math.min(maxTrade, inner.remainingUsdc);
  return { ok: true, data: { amount: String(amount), amountNumber: amount } };
}

async function loadCandidateUniverse(limit: number): Promise<SubscribedMeToken[]> {
  return listSubscribedMeTokens(limit, 0);
}

async function evaluateCandidates(
  tokens: SubscribedMeToken[],
  preferredMeToken?: string | null,
): Promise<{ candidates: Agent1TickCandidate[]; selected: SubscribedMeToken | null }> {
  const candidates: Agent1TickCandidate[] = [];
  let selected: SubscribedMeToken | null = null;
  const preferred = preferredMeToken?.toLowerCase() ?? null;

  const ordered = preferred
    ? [
        ...tokens.filter((token) => token.meToken.toLowerCase() === preferred),
        ...tokens.filter((token) => token.meToken.toLowerCase() !== preferred),
      ]
    : tokens;

  for (const token of ordered) {
    if (isDeniedMeToken(token.meToken)) {
      candidates.push({
        meToken: token.meToken,
        symbol: token.symbol,
        name: token.name,
        hubId: token.hubId,
        selected: false,
        rejectReason: "deny_listed",
      });
      continue;
    }

    const universe = await validateMeTokenUniverse(token.meToken);
    if (!universe.ok) {
      candidates.push({
        meToken: token.meToken,
        symbol: token.symbol,
        name: token.name,
        hubId: token.hubId,
        selected: false,
        rejectReason: universe.reason,
      });
      continue;
    }

    if (!selected) {
      selected = token;
      candidates.push({
        meToken: token.meToken,
        symbol: token.symbol,
        name: token.name,
        hubId: token.hubId,
        selected: true,
      });
    } else {
      candidates.push({
        meToken: token.meToken,
        symbol: token.symbol,
        name: token.name,
        hubId: token.hubId,
        selected: false,
        rejectReason: "not_selected",
      });
    }
  }

  return { candidates, selected };
}

export async function runAgent1Tick(): Promise<Agent1TickResult> {
  const policy = getAgent1Policy();
  const tradingNoOp = executeTradingNoOp("slice_e_live_tick");
  const broadcastEligibility = getTradingBroadcastEligibility();
  const venue = getAgent1VenueStatus();
  const warnings: string[] = [];
  const candidateLimit = parsePositiveInt(process.env.AGENT1_TICK_CANDIDATE_LIMIT, 10);

  if (!broadcastEligibility.allowed) {
    warnings.push("no_broadcast");
    warnings.push("slice_e_live_plan_or_gated");
  } else {
    warnings.push("broadcast_gates_open");
  }

  let modelUsed = false;
  if (isTickModelEnabled() && !hasTickModelCredentials()) {
    warnings.push("model_enabled_but_credentials_missing");
  }

  const tickStateResult = await getTickStateSnapshot();
  const tickState = tickStateResult.ok ? tickStateResult.data : null;
  const tickStoreError = tickStateResult.ok ? null : tickStateResult.message;
  const timestamp = new Date().toISOString();
  let candidateStrategy = resolveCandidateStrategy(false);

  const baseSuccess = {
    agent: "agent1" as const,
    slice: "E-live" as const,
    wouldExecute: false,
    broadcast: false,
    timestamp,
    policy: {
      gates: policy.gates,
      limits: policy.limits,
      trading: policy.trading,
    },
    tickState,
    tickStoreError,
    broadcastAttempt: null as Agent1TickBroadcast | null,
    trading: {
      executed: false,
      reason: tradingNoOp.reason,
    },
    warnings,
  };

  if (!tickStateResult.ok) {
    logger.info("agent1_tick_skipped", { reason: "tick_store_error", message: tickStoreError });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: "tick_store_error",
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: [],
      dryRun: null,
      warnings: [...warnings, "tick_store_error"],
    };
  }

  if (!policy.gates.tradingEnabled || policy.gates.killSwitch) {
    const reason = policy.gates.killSwitch ? "kill_switch_active" : "trading_disabled";
    logger.info("agent1_tick_skipped", { reason, candidateStrategy });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason,
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: [],
      dryRun: null,
    };
  }

  const cooldownCheck = await checkCooldown(policy.limits.cooldownSeconds);
  if (!cooldownCheck.ok) {
    logger.info("agent1_tick_skipped", {
      reason: "tick_store_error",
      message: cooldownCheck.message,
    });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: "tick_store_error",
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: [],
      dryRun: null,
      warnings: [...warnings, "tick_store_error"],
    };
  }

  const cooldown = cooldownCheck.data;
  if (!cooldown.ok) {
    logger.info("agent1_tick_skipped", {
      reason: cooldown.reason,
      remainingSeconds: cooldown.remainingSeconds,
    });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: cooldown.reason,
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: [],
      dryRun: null,
      warnings: [...warnings, "cooldown_active"],
    };
  }

  const tradeAmountResult = await resolveTradeUsdcAmount(policy);
  if (!tradeAmountResult.ok) {
    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: "tick_store_error",
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: [],
      dryRun: null,
      warnings: [...warnings, "tick_store_error"],
    };
  }

  const { amount: tradeUsdcAmount, amountNumber: tradeAmountNumber } = tradeAmountResult.data;

  if (!Number.isFinite(tradeAmountNumber) || tradeAmountNumber <= 0) {
    logger.info("agent1_tick_skipped", { reason: "daily_volume_exceeded" });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: "daily_volume_exceeded",
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: [],
      dryRun: null,
      warnings: [...warnings, "daily_volume_exceeded"],
    };
  }

  let universe: SubscribedMeToken[];
  try {
    universe = await loadCandidateUniverse(candidateLimit);
  } catch (error) {
    return {
      ok: false,
      agent: "agent1",
      slice: "E-live",
      wouldExecute: false,
      broadcast: false,
      error: "subgraph_unavailable",
      message: error instanceof Error ? error.message : "Subgraph query failed",
      status: 503,
    };
  }

  let preferredMeToken: string | null = null;
  if (isTickModelEnabled() && hasTickModelCredentials() && universe.length > 0) {
    const modelSelection = await selectCandidateWithModel(universe);
    if (modelSelection.ok) {
      preferredMeToken = modelSelection.meToken;
      modelUsed = true;
      candidateStrategy = resolveCandidateStrategy(true);
    } else {
      warnings.push(`model_selection_failed:${modelSelection.error}`);
      candidateStrategy = DEFAULT_CANDIDATE_STRATEGY;
    }
  }

  const { candidates, selected } = await evaluateCandidates(universe, preferredMeToken);

  if (!selected) {
    logger.info("agent1_tick_skipped", { reason: "no_eligible_candidates" });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: "no_eligible_candidates",
        candidateStrategy,
        modelUsed,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: candidates,
      dryRun: null,
      warnings: [...warnings, "no_eligible_candidates"],
    };
  }

  const dryRun = await dryRunUsdcToMeToken({
    meToken: selected.meToken,
    usdcAmount: tradeUsdcAmount,
  });

  if (!dryRun.ok) {
    logger.info("agent1_tick_dry_run_failed", {
      meToken: selected.meToken.toLowerCase(),
      error: dryRun.error,
    });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: dryRun.error,
        candidateStrategy,
        modelUsed,
        tradeUsdcAmount,
      },
      candidatesConsidered: candidates,
      dryRun: null,
      warnings: [...warnings, "dry_run_failed"],
    };
  }

  const slippageEstimate = dryRun.quote.slippageBpsEstimate;
  if (slippageEstimate !== null && slippageEstimate > policy.limits.slippageBps) {
    logger.info("agent1_tick_skipped", {
      reason: "slippage_exceeded",
      slippageBps: slippageEstimate,
      limitBps: policy.limits.slippageBps,
    });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: "slippage_exceeded",
        candidateStrategy,
        modelUsed,
        tradeUsdcAmount,
      },
      candidatesConsidered: candidates,
      dryRun: null,
      warnings: [...warnings, "slippage_exceeded"],
    };
  }

  if (slippageEstimate === null) {
    warnings.push("slippage_not_estimated");
  }

  const recordResult = await recordPlannedDryRun(tradeAmountNumber);
  if (!recordResult.ok) {
    logger.info("agent1_tick_skipped", {
      reason: "tick_store_error",
      message: recordResult.message,
    });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: "tick_store_error",
        candidateStrategy,
        modelUsed,
        tradeUsdcAmount,
      },
      candidatesConsidered: candidates,
      dryRun: null,
      warnings: [...warnings, "tick_store_error"],
    };
  }

  const signer = getAgent1SignerStatus();
  const canAttemptBroadcast =
    broadcastEligibility.allowed &&
    venue.gates.broadcastAllowed &&
    signer.canBroadcast &&
    dryRun.alchemyPrepare.attempted &&
    dryRun.alchemyPrepare.ok;

  if (!canAttemptBroadcast) {
    logger.info("agent1_tick_planned", {
      meToken: selected.meToken.toLowerCase(),
      usdcAmount: tradeUsdcAmount,
      candidateStrategy,
      modelUsed,
      prepareAttempted: dryRun.alchemyPrepare.attempted,
      broadcastAllowed: venue.gates.broadcastAllowed,
    });

    return {
      ok: true,
      ...baseSuccess,
      tickState: recordResult.data,
      decision: {
        action: "planned",
        reason: broadcastEligibility.allowed
          ? "planned_prepare_incomplete_or_unsigned"
          : "dry_run_planned",
        candidateStrategy,
        modelUsed,
        tradeUsdcAmount,
      },
      candidatesConsidered: candidates,
      dryRun,
      warnings,
    };
  }

  const prepared =
    dryRun.alchemyPrepare.attempted && dryRun.alchemyPrepare.ok
      ? dryRun.alchemyPrepare.prepared
      : null;

  const sendResult = prepared
    ? await sendPreparedAlchemyCalls(prepared)
    : {
        ok: false as const,
        error: "prepare_missing",
        message: "No prepared calls available for send",
      };

  const broadcastAttempt: Agent1TickBroadcast = sendResult.ok
    ? { attempted: true, ok: true, result: sendResult.result }
    : {
        attempted: true,
        ok: false,
        error: sendResult.error,
        message: sendResult.message,
      };

  if (!sendResult.ok) {
    warnings.push(`broadcast_failed:${sendResult.error}`);
    logger.info("agent1_tick_broadcast_failed", {
      meToken: selected.meToken.toLowerCase(),
      error: sendResult.error,
      message: sendResult.message,
    });

    return {
      ok: true,
      ...baseSuccess,
      tickState: recordResult.data,
      decision: {
        action: "planned",
        reason: "broadcast_failed",
        candidateStrategy,
        modelUsed,
        tradeUsdcAmount,
      },
      candidatesConsidered: candidates,
      dryRun,
      broadcastAttempt,
      trading: {
        executed: false,
        reason: sendResult.error,
      },
      warnings,
    };
  }

  logger.info("agent1_tick_executed", {
    meToken: selected.meToken.toLowerCase(),
    usdcAmount: tradeUsdcAmount,
    candidateStrategy,
    modelUsed,
  });

  return {
    ok: true,
    ...baseSuccess,
    wouldExecute: true,
    broadcast: true,
    tickState: recordResult.data,
    decision: {
      action: "executed",
      reason: "broadcast_sent",
      candidateStrategy,
      modelUsed,
      tradeUsdcAmount,
    },
    candidatesConsidered: candidates,
    dryRun,
    broadcastAttempt,
    trading: {
      executed: true,
      reason: "broadcast_sent",
    },
    warnings: warnings.filter((warning) => warning !== "no_broadcast"),
  };
}
