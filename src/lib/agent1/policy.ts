import { parseDeniedMeTokens } from "@/lib/agent1/deny-list";
import { isAgent1BroadcastEnabled } from "@/lib/agent1/signer";
import { getTickStoreMeta } from "@/lib/agent1/tick-state";
import { getAgent1VenueStatus } from "@/lib/agent1/venue";
import { logger } from "@/lib/logger";
import {
  DEFAULT_STUDIO_SUBGRAPH_URL,
  getSubgraphProviderMode,
  getStudioSubgraphUrl,
} from "@/lib/subgraph/creative-platform-proxy";

export interface Agent1PolicyLimits {
  maxTradeUsdc: number;
  dailyVolumeUsdc: number;
  slippageBps: number;
  cooldownSeconds: number;
}

export interface Agent1PolicyGates {
  tradingEnabled: boolean;
  killSwitch: boolean;
  broadcastEnabled: boolean;
}

export interface Agent1Policy {
  agent: "agent1";
  version: "slice-e-live";
  subgraph: {
    providerMode: "studio" | "goldsky" | "dual";
    studioUrl: string;
  };
  deniedMeTokens: string[];
  limits: Agent1PolicyLimits;
  gates: Agent1PolicyGates;
  trading: {
    /** disabled = gates closed; dry_run = plan only; live = broadcast allowed when venue/signer pass */
    mode: "disabled" | "dry_run" | "live";
    reason: string;
  };
  tick: {
    enabled: true;
    endpoint: "/api/agent1/tick";
    cronSchedule: "*/30 * * * *";
    auth: "bearer_cron_secret";
    store: ReturnType<typeof getTickStoreMeta>;
  };
  venue: Pick<
    ReturnType<typeof getAgent1VenueStatus>["venue"],
    "routerConfirmed" | "abiLabel" | "quoteMode" | "mintPath"
  > & {
    diamondAddress: string;
    hub2UsdcVault: string;
    broadcastAllowed: boolean;
  };
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parsePositiveNumber(
  value: string | undefined,
  defaultValue: number,
  field: string,
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn("policy_invalid_number", { field, value, fallback: defaultValue });
    return defaultValue;
  }

  return parsed;
}

export function getAgent1Policy(): Agent1Policy {
  const tradingEnabled = parseBoolean(process.env.TRADING_ENABLED, false);
  const killSwitch = parseBoolean(process.env.KILL_SWITCH, false);
  const broadcastEnabled = isAgent1BroadcastEnabled();
  const tradingBlocked = !tradingEnabled || killSwitch;
  const venueStatus = getAgent1VenueStatus();
  const liveEligible =
    !tradingBlocked &&
    broadcastEnabled &&
    venueStatus.venue.routerConfirmed &&
    venueStatus.gates.broadcastAllowed;

  const limits: Agent1PolicyLimits = {
    maxTradeUsdc: parsePositiveNumber(process.env.MAX_TRADE_USDC, 25, "MAX_TRADE_USDC"),
    dailyVolumeUsdc: parsePositiveNumber(
      process.env.DAILY_VOLUME_USDC,
      100,
      "DAILY_VOLUME_USDC",
    ),
    slippageBps: parsePositiveNumber(process.env.SLIPPAGE_BPS, 250, "SLIPPAGE_BPS"),
    cooldownSeconds: parsePositiveNumber(
      process.env.COOLDOWN_SECONDS,
      1800,
      "COOLDOWN_SECONDS",
    ),
  };

  const studioUrl = getStudioSubgraphUrl() ?? DEFAULT_STUDIO_SUBGRAPH_URL;
  const deniedMeTokens = Array.from(parseDeniedMeTokens(process.env.AGENT1_DENIED_METOKENS));

  let reason = "trading_disabled_by_default";
  let mode: Agent1Policy["trading"]["mode"] = "disabled";
  if (killSwitch) {
    reason = "kill_switch_active";
    mode = "disabled";
  } else if (!tradingEnabled) {
    reason = "trading_disabled_by_default";
    mode = "disabled";
  } else if (liveEligible) {
    reason = "live_broadcast_enabled";
    mode = "live";
  } else if (!broadcastEnabled) {
    reason = "trading_enabled_dry_run_only_broadcast_disabled";
    mode = "dry_run";
  } else if (!venueStatus.venue.routerConfirmed) {
    reason = "trading_enabled_dry_run_only_router_unconfirmed";
    mode = "dry_run";
  } else {
    reason = "trading_enabled_dry_run_only";
    mode = "dry_run";
  }

  return {
    agent: "agent1",
    version: "slice-e-live",
    subgraph: {
      providerMode: getSubgraphProviderMode(),
      studioUrl,
    },
    deniedMeTokens,
    limits,
    gates: {
      tradingEnabled,
      killSwitch,
      broadcastEnabled,
    },
    trading: {
      mode,
      reason,
    },
    tick: {
      enabled: true,
      endpoint: "/api/agent1/tick",
      cronSchedule: "*/30 * * * *",
      auth: "bearer_cron_secret",
      store: getTickStoreMeta(),
    },
    venue: {
      routerConfirmed: venueStatus.venue.routerConfirmed,
      abiLabel: venueStatus.venue.abiLabel,
      quoteMode: venueStatus.venue.quoteMode,
      mintPath: venueStatus.venue.mintPath,
      diamondAddress: venueStatus.venue.addresses.diamond,
      hub2UsdcVault: venueStatus.venue.addresses.hub2UsdcVault,
      broadcastAllowed: venueStatus.gates.broadcastAllowed,
    },
  };
}

export interface TradingBroadcastEligibility {
  allowed: boolean;
  reason: string;
  policy: Agent1Policy;
}

/** Evaluates whether tick may attempt wallet_sendPreparedCalls (fail-closed). */
export function getTradingBroadcastEligibility(): TradingBroadcastEligibility {
  const policy = getAgent1Policy();

  if (policy.gates.killSwitch) {
    return { allowed: false, reason: "kill_switch_active", policy };
  }
  if (!policy.gates.tradingEnabled) {
    return { allowed: false, reason: "trading_disabled", policy };
  }
  if (!policy.gates.broadcastEnabled) {
    return { allowed: false, reason: "broadcast_disabled", policy };
  }
  if (!policy.venue.routerConfirmed) {
    return { allowed: false, reason: "router_unconfirmed", policy };
  }
  if (!policy.venue.broadcastAllowed || policy.trading.mode !== "live") {
    return { allowed: false, reason: "dry_run_only", policy };
  }

  return { allowed: true, reason: "broadcast_gates_open", policy };
}

export interface TradingNoOpResult {
  executed: false;
  reason: string;
  policy: Agent1Policy;
}

/** Always non-executing — use getTradingBroadcastEligibility + tick send for live. */
export function executeTradingNoOp(intent?: string): TradingNoOpResult {
  const eligibility = getTradingBroadcastEligibility();
  const reason = eligibility.allowed
    ? "broadcast_gates_open_awaiting_tick_send"
    : eligibility.reason === "trading_disabled"
      ? "trading_disabled"
      : eligibility.reason === "kill_switch_active"
        ? "kill_switch_active"
        : eligibility.reason === "broadcast_disabled" ||
            eligibility.reason === "router_unconfirmed" ||
            eligibility.reason === "dry_run_only"
          ? "slice_e_live_dry_run_only"
          : eligibility.reason;

  logger.info("trading_noop", {
    intent,
    reason,
    tradingEnabled: eligibility.policy.gates.tradingEnabled,
    killSwitch: eligibility.policy.gates.killSwitch,
    broadcastEnabled: eligibility.policy.gates.broadcastEnabled,
    mode: eligibility.policy.trading.mode,
  });

  return {
    executed: false,
    reason,
    policy: eligibility.policy,
  };
}
