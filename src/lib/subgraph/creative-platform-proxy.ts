/**
 * Shared routing for the merged creative-platform subgraph (Graph Studio + optional Goldsky rollback).
 * Aligned with creativeplatform/crtv3 `lib/subgraph/creative-platform-proxy.ts`.
 */

export type SubgraphProviderMode = "goldsky" | "studio" | "dual";

const DEFAULT_GOLDSKY_PROJECT_ID = "project_cmh0iv6s500dbw2p22vsxcfo6";

/** Goldsky MeTokens subgraph version (Studio deploy tag should match). */
export const METOKENS_GOLDSKY_VERSION = "1.0.3";

export const DEFAULT_STUDIO_SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/3405/creative-platform/version/latest";

export function getSubgraphProviderMode(): SubgraphProviderMode {
  const rawMode = process.env.SUBGRAPH_PROVIDER_MODE?.toLowerCase();
  if (rawMode === "studio" || rawMode === "dual" || rawMode === "goldsky") {
    return rawMode;
  }
  return "studio";
}

export function getStudioSubgraphUrl(): string | undefined {
  const studio =
    process.env.GRAPH_STUDIO_CREATIVE_PLATFORM_URL?.trim() ||
    process.env.SUBGRAPH_URL?.trim();
  return studio || DEFAULT_STUDIO_SUBGRAPH_URL;
}

function getGoldskyProjectId(): string {
  return process.env.GOLDSKY_PROJECT_ID || DEFAULT_GOLDSKY_PROJECT_ID;
}

function getGoldskyUrl(
  subgraphName: string,
  version: string,
  accessType?: "public" | "private",
): string {
  const isPrivate = Boolean(process.env.GOLDSKY_API_KEY);
  const resolvedAccess = accessType ?? (isPrivate ? "private" : "public");
  const projectId = getGoldskyProjectId();
  return `https://api.goldsky.com/api/${resolvedAccess}/${projectId}/subgraphs/${subgraphName}/${version}/gn`;
}

export type SubgraphProxyTarget = "metokens";

export function resolveSubgraphEndpoints(target: SubgraphProxyTarget): string[] {
  const mode = getSubgraphProviderMode();
  const studioUrl = getStudioSubgraphUrl();
  const isPrivate = Boolean(process.env.GOLDSKY_API_KEY);

  const goldskyPrimary = getGoldskyUrl(
    "metokens",
    METOKENS_GOLDSKY_VERSION,
    isPrivate ? "private" : "public",
  );

  const goldskyPublicFallback = getGoldskyUrl(
    "metokens",
    METOKENS_GOLDSKY_VERSION,
    "public",
  );

  const endpoints: string[] = [];

  if (mode === "studio" || mode === "dual") {
    if (studioUrl) {
      endpoints.push(studioUrl);
    }
  }
  if (mode === "goldsky" || mode === "dual" || !studioUrl) {
    endpoints.push(goldskyPrimary);
  }
  if (isPrivate && mode !== "studio") {
    endpoints.push(goldskyPublicFallback);
  }

  if (target !== "metokens") {
    return endpoints;
  }

  return endpoints;
}

export function buildSubgraphRequestHeaders(endpoint: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (endpoint.includes("goldsky.com") && process.env.GOLDSKY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.GOLDSKY_API_KEY}`;
  }
  return headers;
}

export interface GraphQlError {
  message?: string;
}

export function isGraphQlResponseSuccessful(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }
  const payload = data as { data?: unknown; errors?: GraphQlError[] };
  if (payload.errors?.length) {
    return false;
  }
  return payload.data != null;
}

export function getGraphQlResponseErrors(data: unknown): GraphQlError[] {
  if (data && typeof data === "object" && Array.isArray((data as { errors?: unknown }).errors)) {
    return (data as { errors: GraphQlError[] }).errors;
  }
  return [{ message: "Invalid or empty GraphQL response" }];
}

export function formatGraphQlErrors(errors: GraphQlError[]): string {
  return errors.map((error) => error.message ?? "Unknown GraphQL error").join("; ");
}

export const STUDIO_URL_HINT =
  "Set GRAPH_STUDIO_CREATIVE_PLATFORM_URL to the Graph Studio creative-platform deployment.";

export const GOLDSKY_ROLLBACK_HINT =
  "For emergency rollback, set SUBGRAPH_PROVIDER_MODE=goldsky (Goldsky metokens/1.0.3 may be unavailable).";

export interface SubgraphQueryResult<T> {
  data: T;
  endpoint: string;
}

export async function queryCreativePlatformSubgraph<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<SubgraphQueryResult<T>> {
  const endpoints = resolveSubgraphEndpoints("metokens");

  if (endpoints.length === 0) {
    throw new Error(`No subgraph endpoint configured. ${STUDIO_URL_HINT}`);
  }

  let lastHttpError: { status: number; details: string; endpoint: string } | null = null;
  let lastGraphQlError: { message: string; endpoint: string } | null = null;

  for (const endpoint of endpoints) {
    const headers = buildSubgraphRequestHeaders(endpoint);
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      lastHttpError = { status: response.status, details: errorText, endpoint };
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      lastHttpError = {
        status: response.status,
        details: "Failed to parse JSON response",
        endpoint,
      };
      continue;
    }

    if (!isGraphQlResponseSuccessful(payload)) {
      const message = formatGraphQlErrors(getGraphQlResponseErrors(payload));
      lastGraphQlError = { message, endpoint };
      continue;
    }

    return {
      data: (payload as { data: T }).data,
      endpoint,
    };
  }

  if (lastGraphQlError) {
    throw new Error(`Subgraph GraphQL error (${lastGraphQlError.endpoint}): ${lastGraphQlError.message}`);
  }

  if (lastHttpError) {
    throw new Error(
      `Subgraph HTTP ${lastHttpError.status} (${lastHttpError.endpoint}): ${lastHttpError.details}`,
    );
  }

  throw new Error("No subgraph endpoint available");
}
