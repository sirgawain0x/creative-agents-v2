import { isAddress } from "viem";

import type { SubscribedMeToken } from "@/lib/agent1/metokens-subgraph";
import { logger } from "@/lib/logger";

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const AI_GATEWAY_CHAT_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

export function isTickModelEnabled(): boolean {
  const flag = process.env.AGENT1_TICK_MODEL_ENABLED?.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(flag ?? "");
}

export function getGeminiApiKey(): string | null {
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    null;
  return key || null;
}

export function getAiGatewayApiKey(): string | null {
  const key =
    process.env.AI_GATEWAY_API_KEY?.trim() ||
    process.env.VERCEL_AI_GATEWAY_API_KEY?.trim() ||
    null;
  return key || null;
}

export function hasTickModelCredentials(): boolean {
  return Boolean(
    getGeminiApiKey() ||
      getAiGatewayApiKey() ||
      process.env.OLLAMA_BASE_URL?.trim(),
  );
}

export function getTickModelName(): string {
  return (
    process.env.AGENT1_TICK_MODEL?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    DEFAULT_GEMINI_MODEL
  );
}

export interface TickModelSelection {
  ok: true;
  meToken: string;
  provider: "gemini" | "ai_gateway" | "ollama";
  model: string;
}

export interface TickModelFailure {
  ok: false;
  error: string;
  message: string;
}

function buildSelectionPrompt(candidates: SubscribedMeToken[]): string {
  const lines = candidates.map(
    (token, index) =>
      `${index + 1}. meToken=${token.meToken} symbol=${token.symbol} name=${token.name} hubId=${token.hubId}`,
  );
  return [
    "You are selecting one MeToken candidate for a Survival First USDC mint tick.",
    "Prefer hubId=2 when available. Reply with ONLY a JSON object: {\"meToken\":\"0x...\"}.",
    "Candidates:",
    ...lines,
  ].join("\n");
}

function parseMeTokenFromModelText(text: string, allowed: Set<string>): string | null {
  const trimmed = text.trim();
  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { meToken?: string };
      const address = parsed.meToken?.trim().toLowerCase();
      if (address && allowed.has(address) && isAddress(address)) {
        return address;
      }
    }
  } catch {
    // fall through to regex
  }

  const hexMatch = trimmed.match(/0x[a-fA-F0-9]{40}/);
  if (hexMatch) {
    const address = hexMatch[0].toLowerCase();
    if (allowed.has(address)) {
      return address;
    }
  }
  return null;
}

async function selectViaGemini(
  candidates: SubscribedMeToken[],
): Promise<TickModelSelection | TickModelFailure> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, error: "gemini_key_missing", message: "GEMINI_API_KEY unset" };
  }

  const model = getTickModelName();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildSelectionPrompt(candidates) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 128 },
      }),
      cache: "no-store",
    });

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };

    if (!response.ok || payload.error) {
      return {
        ok: false,
        error: "gemini_request_failed",
        message: payload.error?.message ?? `Gemini HTTP ${response.status}`,
      };
    }

    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const allowed = new Set(candidates.map((token) => token.meToken.toLowerCase()));
    const meToken = parseMeTokenFromModelText(text, allowed);
    if (!meToken) {
      return {
        ok: false,
        error: "gemini_invalid_selection",
        message: "Model response did not include an allowed meToken",
      };
    }

    return { ok: true, meToken, provider: "gemini", model };
  } catch (error) {
    return {
      ok: false,
      error: "gemini_network_error",
      message: error instanceof Error ? error.message : "gemini_network_error",
    };
  }
}

async function selectViaAiGateway(
  candidates: SubscribedMeToken[],
): Promise<TickModelSelection | TickModelFailure> {
  const apiKey = getAiGatewayApiKey();
  if (!apiKey) {
    return { ok: false, error: "ai_gateway_key_missing", message: "AI_GATEWAY_API_KEY unset" };
  }

  const model = getTickModelName().startsWith("google/")
    ? getTickModelName()
    : `google/${getTickModelName()}`;

  try {
    const response = await fetch(AI_GATEWAY_CHAT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 128,
        messages: [{ role: "user", content: buildSelectionPrompt(candidates) }],
      }),
      cache: "no-store",
    });

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!response.ok || payload.error) {
      return {
        ok: false,
        error: "ai_gateway_request_failed",
        message: payload.error?.message ?? `AI Gateway HTTP ${response.status}`,
      };
    }

    const text = payload.choices?.[0]?.message?.content ?? "";
    const allowed = new Set(candidates.map((token) => token.meToken.toLowerCase()));
    const meToken = parseMeTokenFromModelText(text, allowed);
    if (!meToken) {
      return {
        ok: false,
        error: "ai_gateway_invalid_selection",
        message: "Model response did not include an allowed meToken",
      };
    }

    return { ok: true, meToken, provider: "ai_gateway", model };
  } catch (error) {
    return {
      ok: false,
      error: "ai_gateway_network_error",
      message: error instanceof Error ? error.message : "ai_gateway_network_error",
    };
  }
}

async function selectViaOllama(
  candidates: SubscribedMeToken[],
): Promise<TickModelSelection | TickModelFailure> {
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim();
  if (!baseUrl) {
    return { ok: false, error: "ollama_unset", message: "OLLAMA_BASE_URL unset" };
  }

  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/generate`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: buildSelectionPrompt(candidates),
        stream: false,
        options: { temperature: 0.2 },
      }),
      cache: "no-store",
    });

    const payload = (await response.json()) as {
      response?: string;
      error?: string;
    };

    if (!response.ok || payload.error) {
      return {
        ok: false,
        error: "ollama_request_failed",
        message: payload.error ?? `Ollama HTTP ${response.status}`,
      };
    }

    const allowed = new Set(candidates.map((token) => token.meToken.toLowerCase()));
    const meToken = parseMeTokenFromModelText(payload.response ?? "", allowed);
    if (!meToken) {
      return {
        ok: false,
        error: "ollama_invalid_selection",
        message: "Model response did not include an allowed meToken",
      };
    }

    return { ok: true, meToken, provider: "ollama", model };
  } catch (error) {
    return {
      ok: false,
      error: "ollama_network_error",
      message: error instanceof Error ? error.message : "ollama_network_error",
    };
  }
}

/**
 * Optional Gemini / AI Gateway / Ollama assist for candidate selection.
 * Fail-soft: callers should fall back to newest_subscribe_first on failure.
 */
export async function selectCandidateWithModel(
  candidates: SubscribedMeToken[],
): Promise<TickModelSelection | TickModelFailure> {
  if (candidates.length === 0) {
    return { ok: false, error: "no_candidates", message: "No candidates for model selection" };
  }

  if (getGeminiApiKey()) {
    const result = await selectViaGemini(candidates);
    logger.info("agent1_tick_model_gemini", {
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
    return result;
  }

  if (getAiGatewayApiKey()) {
    const result = await selectViaAiGateway(candidates);
    logger.info("agent1_tick_model_ai_gateway", {
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
    return result;
  }

  if (process.env.OLLAMA_BASE_URL?.trim()) {
    const result = await selectViaOllama(candidates);
    logger.info("agent1_tick_model_ollama", {
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
    return result;
  }

  return {
    ok: false,
    error: "model_credentials_missing",
    message: "No Gemini, AI Gateway, or Ollama credentials configured",
  };
}

const SMOKE_PROMPT = 'Reply with ONLY a JSON object: {"ok":true}. No other text.';

export interface TickModelSmokeSuccess {
  ok: true;
  provider: "gemini" | "ai_gateway" | "ollama";
  model: string;
  /** Whether the model body contained parseable {"ok":true}; connectivity still passes when false. */
  responseOkParsed: boolean;
}

export interface TickModelSmokeFailure {
  ok: false;
  error: string;
  message: string;
  provider?: "gemini" | "ai_gateway" | "ollama";
  model?: string;
}

export type TickModelSmokeResult = TickModelSmokeSuccess | TickModelSmokeFailure;

function resolveAiGatewayModelName(): string {
  const raw = getTickModelName();
  return raw.startsWith("google/") ? raw : `google/${raw}`;
}

function parseSmokeOkFromModelText(text: string): boolean {
  const trimmed = text.trim();
  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { ok?: boolean };
      return parsed.ok === true;
    }
  } catch {
    // fall through
  }
  return false;
}

async function smokeViaGemini(): Promise<TickModelSmokeResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, error: "gemini_key_missing", message: "GEMINI_API_KEY unset" };
  }

  const model = getTickModelName();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: SMOKE_PROMPT }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 32 },
      }),
      cache: "no-store",
    });

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };

    if (!response.ok || payload.error) {
      return {
        ok: false,
        error: "gemini_request_failed",
        message: payload.error?.message ?? `Gemini HTTP ${response.status}`,
        provider: "gemini",
        model,
      };
    }

    const text =
      payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const responseOkParsed = parseSmokeOkFromModelText(text);

    return { ok: true, provider: "gemini", model, responseOkParsed };
  } catch (error) {
    return {
      ok: false,
      error: "gemini_network_error",
      message: error instanceof Error ? error.message : "gemini_network_error",
      provider: "gemini",
      model,
    };
  }
}

async function smokeViaAiGateway(): Promise<TickModelSmokeResult> {
  const apiKey = getAiGatewayApiKey();
  if (!apiKey) {
    return { ok: false, error: "ai_gateway_key_missing", message: "AI_GATEWAY_API_KEY unset" };
  }

  const model = resolveAiGatewayModelName();

  try {
    const response = await fetch(AI_GATEWAY_CHAT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 32,
        messages: [{ role: "user", content: SMOKE_PROMPT }],
      }),
      cache: "no-store",
    });

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!response.ok || payload.error) {
      return {
        ok: false,
        error: "ai_gateway_request_failed",
        message: payload.error?.message ?? `AI Gateway HTTP ${response.status}`,
        provider: "ai_gateway",
        model,
      };
    }

    const text = payload.choices?.[0]?.message?.content ?? "";
    const responseOkParsed = parseSmokeOkFromModelText(text);

    return { ok: true, provider: "ai_gateway", model, responseOkParsed };
  } catch (error) {
    return {
      ok: false,
      error: "ai_gateway_network_error",
      message: error instanceof Error ? error.message : "ai_gateway_network_error",
      provider: "ai_gateway",
      model,
    };
  }
}

async function smokeViaOllama(): Promise<TickModelSmokeResult> {
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim();
  if (!baseUrl) {
    return { ok: false, error: "ollama_unset", message: "OLLAMA_BASE_URL unset" };
  }

  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/generate`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: SMOKE_PROMPT,
        stream: false,
        options: { temperature: 0 },
      }),
      cache: "no-store",
    });

    const payload = (await response.json()) as {
      response?: string;
      error?: string;
    };

    if (!response.ok || payload.error) {
      return {
        ok: false,
        error: "ollama_request_failed",
        message: payload.error ?? `Ollama HTTP ${response.status}`,
        provider: "ollama",
        model,
      };
    }

    const responseOkParsed = parseSmokeOkFromModelText(payload.response ?? "");

    return { ok: true, provider: "ollama", model, responseOkParsed };
  } catch (error) {
    return {
      ok: false,
      error: "ollama_network_error",
      message: error instanceof Error ? error.message : "ollama_network_error",
      provider: "ollama",
      model,
    };
  }
}

/**
 * Minimal model connectivity probe using the same provider priority as tick selection.
 * Does not read trading/broadcast policy or execute trades.
 */
export async function smokeTickModel(): Promise<TickModelSmokeResult> {
  if (getGeminiApiKey()) {
    const result = await smokeViaGemini();
    logger.info("agent1_tick_model_smoke_gemini", {
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
    return result;
  }

  if (getAiGatewayApiKey()) {
    const result = await smokeViaAiGateway();
    logger.info("agent1_tick_model_smoke_ai_gateway", {
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
    return result;
  }

  if (process.env.OLLAMA_BASE_URL?.trim()) {
    const result = await smokeViaOllama();
    logger.info("agent1_tick_model_smoke_ollama", {
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
    return result;
  }

  return {
    ok: false,
    error: "model_credentials_missing",
    message: "No Gemini, AI Gateway, or Ollama credentials configured",
  };
}
