# creative-agents-v2

Deployable Next.js App Router scaffold for Creative Agents (`creative-agents` package). Slice A provides Agent 1 policy gates, health endpoints, structured logging, and cron auth helpers — **no live trading**.

## Survival First

- **Trading is disabled by default** (`TRADING_ENABLED=false`).
- Slice A exposes policy and health only; trade execution is a **no-op** even when gates are open.
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
| `SUBGRAPH_URL` | Studio creative-platform URL | The Graph subgraph endpoint |
| `CRON_SECRET` | _(unset)_ | Bearer token for future `/api/agent1/tick` cron auth |

## API Routes (Slice A)

| Route | Description |
| --- | --- |
| `GET /api/agent1/health` | Agent 1 health + trading mode |
| `GET /api/agent1/policy` | Env-driven policy limits and gates |
| `GET /api/agent2/health` | Agent 2 stub (future slice) |

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
```

## Deploy (Vercel)

1. Import this repository into Vercel.
2. Set environment variables from the table above (keep `TRADING_ENABLED=false`).
3. Set `CRON_SECRET` in Vercel project settings (not in git).
4. Deploy — Next.js App Router is detected automatically.

## Slice Roadmap & Blockers

| Slice | Scope | Blockers |
| --- | --- | --- |
| **A** (current) | Scaffold, policy gates, health APIs, logger, cron helper | — |
| **B** | Subgraph reads / creative platform indexing | Subgraph schema finalization, query module |
| **C** | Agent 1 tick loop (`/api/agent1/tick`) | CRON wiring, idempotency, volume tracking |
| **D** | Trade preparation (still no live execution) | Wallet/signer architecture, risk review |
| **E** | Paper / simulated trading | Testnet credentials, simulation harness |
| **F** | Live trading (if approved) | G2 license selection, security audit, `TRADING_ENABLED` governance |

## License

Pending — G2 has not selected license terms yet. No LICENSE file is included.
