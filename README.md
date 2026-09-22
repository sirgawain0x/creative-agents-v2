# creative-agents-v2

Deployable Next.js App Router scaffold for Creative Agents (`creative-agents` package). Slice B adds read-only MeToken universe discovery (Studio subgraph), wallet balance reads, and `/api/agent1/quote` — **no live trading or signing**.

## Survival First

- **Trading is disabled by default** (`TRADING_ENABLED=false`).
- Slice B is read-only: quotes and balances never sign or execute swaps.
- Use `KILL_SWITCH=true` to hard-block any future trading paths.
- Do not add wallet keys, exchange credentials, or signing secrets to this repo.

## Environment Variables

Copy `.env.example` to `.env.local` for local development:

| Variable | Default | Description |
| --- | --- | --- |
| `TRADING_ENABLED` | `false` | Master gate for trading (must stay false until later slices) |
| `KILL_SWITCH` | `false` | Emergency stop — overrides `TRADING_ENABLED` |
| `MAX_TRADE_USDC` | `25` | Max single trade size (USDC) |
| `DAILY_VOLUME_USDC` | `100` | Max daily volume (USDC) |
| `SLIPPAGE_BPS` | `250` | Slippage tolerance (basis points) |
| `COOLDOWN_SECONDS` | `1800` | Cooldown between trades (seconds) |
| `AGENT1_DENIED_METOKENS` | _(empty)_ | Optional comma-separated deny list (reject even if subgraph-listed) |
| `SUBGRAPH_PROVIDER_MODE` | `studio` | `studio` (preferred), `goldsky`, or `dual` |
| `GRAPH_STUDIO_CREATIVE_PLATFORM_URL` | Studio creative-platform URL | Locked Studio subgraph endpoint |
| `AGENT1_WALLET_ADDRESS` | _(unset)_ | Agent wallet for read-only USDC + MeToken balance reads |
| `BASE_RPC_URL` | _(unset)_ | Base RPC for balance/quote reads (optional for mock quotes) |
| `AGENT1_QUOTE_MODE` | `mock` | `mock` (staging) or `onchain` (diamond `calculateMeTokensMinted`) |
| `AGENT1_METOKENS_DIAMOND_ADDRESS` | _(unset)_ | **G2 must confirm** before treating as production truth |
| `CRON_SECRET` | _(unset)_ | Bearer token for future `/api/agent1/tick` cron auth |

## API Routes

| Route | Description |
| --- | --- |
| `GET /api/agent1/health` | Health, subgraph sample, optional wallet balances |
| `GET /api/agent1/policy` | Env-driven policy limits and gates |
| `GET/POST /api/agent1/quote` | Read-only USDC → subgraph-listed MeToken quote |
| `GET /api/agent2/health` | Agent 2 stub (future slice) |

### Slice B — `/api/agent1/quote`

Read-only quote for USDC → MeToken on Base. Rejects:

- Unknown MeToken (not in subgraph `Subscribe` events)
- `AGENT1_DENIED_METOKENS` hits
- `usdcAmount` above `MAX_TRADE_USDC`

**Query (GET):** `?meToken=0x…&usdcAmount=10`

**Body (POST):** `{ "meToken": "0x…", "usdcAmount": "10" }`

#### Quote path & G2 blockers

CreativeTV router/diamond addresses are **not G2-confirmed** for production execute.

| Mode | Behavior |
| --- | --- |
| `AGENT1_QUOTE_MODE=mock` (default) | Staging ratio quote; safe when `BASE_RPC_URL` unset |
| `AGENT1_QUOTE_MODE=onchain` | Read-only `calculateMeTokensMinted` on `AGENT1_METOKENS_DIAMOND_ADDRESS` via `BASE_RPC_URL` |

Both modes set `venue.routerConfirmed: false`. G2 must confirm diamond/router ABI parity with `tv.creativeplatform.xyz/market` before Slice E live execute.

**MeToken discovery:** `Subscribe` subgraph entities (aligned with `creativeplatform/crtv3` `/api/metokens-subgraph`). `Register` entities are hub registrations (hubs 1–4), not the token universe.

## Local Development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build & Verify

```bash
pnpm build
pnpm start
pnpm lint
pnpm typecheck
pnpm test
```

Smoke test hits live Studio subgraph (read-only).

## Deploy (Vercel)

1. Import this repository into Vercel.
2. Set environment variables from the table above (keep `TRADING_ENABLED=false`).
3. Set `CRON_SECRET` in Vercel project settings (not in git).
4. Deploy — Next.js App Router is detected automatically.

## Slice Roadmap & Blockers

| Slice | Scope | Blockers |
| --- | --- | --- |
| **A** | Scaffold, policy gates, health APIs, logger, cron helper | — |
| **B** (current) | Subgraph MeToken universe, wallet reads, read-only quote API | G2 router/diamond confirm for production onchain quotes |
| **C** | Alchemy Agent Wallet signer + dry-run | Session credentials |
| **D** | Ollama tick → policy → quote | Model keys |
| **E** | Live execute + Gemini + cron | Funding, router confirm |
| **F** | Alerts + runbook | Alert channel |

## License

Proprietary — All Rights Reserved. Copyright (c) 2026 Creative Platform, Inc. See [LICENSE](./LICENSE).
