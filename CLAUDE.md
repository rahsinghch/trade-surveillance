# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server at http://localhost:3000
npm run build    # production build
npm run lint     # ESLint check
```

There is no test suite.

## Environment

Copy `.env.local.example` to `.env.local` and set `ANTHROPIC_API_KEY`. The app runs fully without the key — `/api/triage` falls back to a deterministic mock engine.

## Architecture

### Request flow

All three data-ingestion routes (`/api/generate`, `/api/upload`, `/api/fetch-market`) produce `TradeOrder[]`, pass them through `lib/patternDetector.ts`, and return `{ trades, alerts }` to the client. The client then optionally calls `/api/triage` (Claude AI) and `/api/escalate` (simulated compliance actions) per alert.

```
Data source route → detectAllPatterns() → alerts[]
                                              ↓
                               /api/triage (claude-sonnet-4-6)
                                              ↓
                               /api/escalate (simulated Jira/Slack/email)
```

### Key files

| File | Role |
|---|---|
| `app/page.tsx` | Entire dashboard UI — single `Dashboard` component, all state lives here |
| `lib/types.ts` | Canonical TypeScript interfaces shared across client and server |
| `lib/patternDetector.ts` | Pure pattern-detection engine; `detectAllPatterns()` is the only export |
| `lib/tradeGenerator.ts` | Synthetic NSE/BSE session generator with 5 injected suspicious scenarios |
| `app/api/triage/route.ts` | Claude triage; falls back to `mockTriage()` when `ANTHROPIC_API_KEY` is absent |
| `app/api/escalate/route.ts` | Simulated compliance workflows — no real Jira/Slack/email integrations |

### Pattern detector

`detectAllPatterns(trades)` runs four detectors in sequence: Layering, Spoofing, Wash Trading, Momentum Ignition, capped at 25 alerts. **Front Running** is described in the README but is not implemented in `patternDetector.ts`.

Detection windows are per `traderId|instrument` key. Each detector uses a sliding time window (3–5 minutes) and emits at most one alert per key via a `seen` set. Alert IDs come from a module-level counter (`alertSeq`) that resets on server restart.

### Triage API

`POST /api/triage` sends the full `SuspiciousAlert` to Claude (`claude-sonnet-4-6`) with a structured JSON schema prompt. Without an API key it calls `mockTriage()`, which assigns verdict and confidence based on severity alone. The response is always `TriageResult`.

### Escalation API

`POST /api/escalate` takes `{ alert, triage }` and returns `EscalationAction[]` based on verdict × severity:

| Condition | Actions |
|---|---|
| `ESCALATE` (any) | Jira case + Slack `#compliance-alerts` |
| `ESCALATE` + HIGH/CRITICAL | + Watchlist flag (72-hr) |
| `ESCALATE` + CRITICAL | + Email alert |
| `MONITOR` | Slack `#surveillance-watch` + soft watchlist (7-day) |

All actions are simulated — no external service calls.

### State management

All application state (`trades`, `alerts`, `triageMap`, `escalationLog`, replay state) lives in the single `Dashboard` component in `app/page.tsx`. There is no global state library. The server is stateless between requests.