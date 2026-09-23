import { parseDeniedMeTokens } from "@/lib/agent1/deny-list";
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
}

export interface Agent1Policy {
  agent: "agent1";
  version: "slice-e-prep";
  subgraph: {
    providerMode: "studio" | "goldsky" | "dual";
    studioUrl: string;
  };
  deniedMeTokens: string[];
  limits: Agent1PolicyLimits;
  gates: Agent1PolicyGates;
  trading: {
    /** disabled = gates closed; dry_run = gates open but never broadcasts (Slice E prep) */
    mode: "disabled" | "dry_run";
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
  const tradingBlocked = !tradingEnabled || killSwitch;
  const venueStatus = getAgent1VenueStatus();

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
  if (killSwitch) {
    reason = "kill_switch_active";
  } else if (tradingEnabled) {
    reason = "trading_enabled_but_slice_e_prep_dry_run_only";
  }

  return {
    agent: "agent1",
    version: "slice-e-prep",
    subgraph: {
      providerMode: getSubgraphProviderMode(),
      studioUrl,
    },
    deniedMeTokens,
    limits,
    gates: {
      tradingEnabled,
      killSwitch,
    },
    trading: {
      mode: tradingBlocked ? "disabled" : "dry_run",
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
    },
  };
}

export interface TradingNoOpResult {
  executed: false;
  reason: string;
  policy: Agent1Policy;
}

export function executeTradingNoOp(intent?: string): TradingNoOpResult {
  const policy = getAgent1Policy();
  const blocked = !policy.gates.tradingEnabled || policy.gates.killSwitch;

  const reason = blocked
    ? policy.gates.killSwitch
      ? "kill_switch_active"
      : "trading_disabled"
    : "slice_e_prep_dry_run_only";

  logger.info("trading_noop", {
    intent,
    reason,
    tradingEnabled: policy.gates.tradingEnabled,
    killSwitch: policy.gates.killSwitch,
  });

  return {
    executed: false,
    reason,
    policy,
  };
}
