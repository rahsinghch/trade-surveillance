# 🛡️ TradeGuard AI — Trade Surveillance Platform

An AI-powered trade surveillance system that ingests order/trade data, detects suspicious patterns, triages alerts with Claude AI, and triggers automated compliance workflows.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Browser — Next.js Dashboard                     │
│                                                                         │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────────────────┐   │
│  │ Trade Feed  │  │  Alerts Panel    │  │   AI Triage Panel       │   │
│  │  (replay)   │  │  (detected       │  │   Claude verdict +      │   │
│  │             │  │   patterns)      │  │   confidence score      │   │
│  └─────────────┘  └──────────────────┘  └─────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              Escalation Log (Jira / Slack / Watchlist / Email)   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  Data source tabs:  ⚡ Synthetic  |  📁 Upload File  |  🌐 Market Feed  │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ HTTP (Next.js API Routes)
          ┌────────────────┼────────────────────┐
          ▼                ▼                    ▼
  ┌──────────────┐  ┌────────────┐  ┌──────────────────┐
  │ /api/generate│  │ /api/upload│  │ /api/fetch-market│
  │              │  │            │  │                  │
  │ Synthetic    │  │ Parse CSV  │  │ Yahoo Finance    │
  │ trade data + │  │ or JSON    │  │ 1-min OHLCV      │
  │ 5 scenarios  │  │ (15 MB max)│  │ (up to 5 symbols)│
  └──────┬───────┘  └─────┬──────┘  └────────┬─────────┘
         │                │                   │
         └────────────────┴───────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   lib/patternDetector │
              │                       │
              │  • Layering           │
              │  • Spoofing           │
              │  • Wash Trading       │
              │  • Momentum Ignition  │
              │  • Front Running      │
              └───────────┬───────────┘
                          │ SuspiciousAlert[]
          ┌───────────────┴───────────────┐
          ▼                               ▼
  ┌───────────────┐             ┌─────────────────┐
  │  /api/triage  │             │  /api/escalate  │
  │               │             │                 │
  │  Anthropic    │────────────▶│  Jira case      │
  │  Claude API   │  verdict +  │  Slack notify   │
  │  (claude-     │  confidence │  Watchlist flag │
  │  sonnet-4-6)  │             │  Email alert    │
  └───────────────┘             └─────────────────┘
```

### Data Flow

```
Trade Data ──▶ Pattern Detection ──▶ Alert Queue
                                          │
                                     Claude Triage
                                          │
                               ┌──────────┴──────────┐
                          ESCALATE               MONITOR / FP
                               │                      │
                          Jira + Slack +         Slack watch +
                          Watchlist (+Email       soft watchlist
                          if CRITICAL)
```

---

## Features

### Task 1 — Trade Data Ingestion
- **Synthetic replay**: generates a full NSE/BSE trading session (165 orders, 5 injected suspicious scenarios) with configurable replay speed (1×, 5×, 10×)
- **File upload**: drag-and-drop CSV or JSON with flexible column detection; 15 MB limit
- **Live market feed**: fetches real 1-minute OHLCV candles from Yahoo Finance and converts them to order-level events (up to 5 symbols per request)

### Task 2 — Suspicious Pattern Detection
Five patterns, each with severity classification:

| Pattern | Severity | Detection Logic |
|---|---|---|
| **Layering** | HIGH | ≥60% cancel rate on dominant side, median cancel <2 s, opposite side executed |
| **Spoofing** | HIGH | ≥3 orders cancelled sub-1 s, opposite-side fills at distorted price |
| **Wash Trading** | CRITICAL | Matched round-trips between two traders, qty within 25%, price within 0.7%, within 2-min windows |
| **Momentum Ignition** | MEDIUM | Escalating same-direction sequence, then large reversal ≥1.5× final size |
| **Front Running** | CRITICAL | Pre-positioning before large institutional order, profit on price impact |

### Task 3 — AI-Driven Alert Triage
Each alert is analysed by **Claude claude-sonnet-4-6** via the Anthropic API:
- **Verdict**: `ESCALATE` / `MONITOR` / `FALSE_POSITIVE`
- **Confidence score**: 0–100%
- **Rationale**: 2–3 sentence evidence-based assessment
- **Key findings**: quantitative metrics vs baseline
- **Risk factors**: applicable regulatory references (SEBI, MiFID II, SEC Rule 10b-5)

Falls back to a deterministic rule-based mock if `ANTHROPIC_API_KEY` is not set, so the app is fully functional without an API key.

### Task 4 — Automated Escalation Workflows
Actions triggered automatically after triage, based on verdict × severity:

| Condition | Actions |
|---|---|
| ESCALATE (any) | Jira compliance case + Slack `#compliance-alerts` |
| ESCALATE + HIGH/CRITICAL | + Watchlist flag (72-hr enhanced monitoring) |
| ESCALATE + CRITICAL | + Email to compliance head and legal |
| MONITOR | Slack `#surveillance-watch` + soft watchlist (7-day) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 |
| AI | Anthropic Claude claude-sonnet-4-6 (`@anthropic-ai/sdk`) |
| Market data | Yahoo Finance unofficial API |
| Deployment | Vercel |

---

## Local Setup

### Prerequisites
- Node.js 18+
- npm 9+

### 1. Clone and install

```bash
git clone https://github.com/rahsinghch/trade-surveillance.git
cd trade-surveillance
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
# Required for live Claude AI triage (Task 3)
# Get your key at https://console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...
```

> **Note:** The app works without an API key — it falls back to a deterministic triage engine. Add the key to enable real Claude analysis.

### 3. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Usage

### Synthetic Data (demo mode)
1. Click **⚡ Generate Trade Dataset** — replays 165 trades with 5 injected suspicious scenarios
2. Suspicious trades are highlighted in amber in the feed
3. Click **🤖 Triage with AI** on any alert, or **🤖 Auto-Triage All** to process all alerts sequentially
4. Escalation actions appear in the log at the bottom

### File Upload
1. Switch to the **📁 Upload File** tab
2. Drag-and-drop or browse for a `.csv` or `.json` file
3. Download **↓ Sample CSV** to see the expected format
4. Click **▶ Ingest File** — the pattern detector runs automatically

**CSV column names** (flexible, case-insensitive):

```
orderId, traderId, instrument, exchange, orderType, quantity, price, timestamp, status, cancelledAt
```

**JSON format** — array of order objects, or `{ "trades": [...] }`:

```json
[
  {
    "orderId": "ORD-001",
    "traderId": "T-1001",
    "instrument": "HDFCBANK",
    "exchange": "NSE",
    "orderType": "BUY",
    "quantity": 5000,
    "price": 1520.50,
    "timestamp": "2026-06-06T09:30:00.000Z",
    "status": "EXECUTED"
  }
]
```

### Live Market Feed
1. Switch to the **🌐 Market Feed** tab
2. Enter Yahoo Finance ticker symbols (comma-separated, max 5):
   - NSE stocks: `HDFCBANK.NS`, `RELIANCE.NS`, `TCS.NS`
   - BSE stocks: `HDFCBANK.BO`, `RELIANCE.BO`
3. Click **🌐 Fetch Live Data** — pulls today's 1-minute candles and runs detection

---

## API Reference

### `POST /api/generate`
Generates a synthetic trading session with injected suspicious patterns.

**Response**
```json
{ "trades": TradeOrder[], "alerts": SuspiciousAlert[] }
```

---

### `POST /api/upload`
Ingests a CSV or JSON file and runs pattern detection.

**Request** — `multipart/form-data`
| Field | Type | Description |
|---|---|---|
| `file` | File | `.csv` or `.json`, max 15 MB |

**Response**
```json
{ "trades": TradeOrder[], "alerts": SuspiciousAlert[], "fileName": "string" }
```

---

### `POST /api/fetch-market`
Fetches live OHLCV data from Yahoo Finance and converts to order-level events.

**Request** — `application/json`
```json
{ "symbols": ["HDFCBANK.NS", "TCS.NS"] }
```

**Response**
```json
{ "trades": TradeOrder[], "alerts": SuspiciousAlert[], "symbols": ["HDFCBANK.NS"], "warnings": [] }
```

---

### `POST /api/triage`
Triages a single alert using Claude AI.

**Request** — `application/json` — a `SuspiciousAlert` object

**Response**
```json
{
  "verdict": "ESCALATE | MONITOR | FALSE_POSITIVE",
  "confidence": 91,
  "rationale": "string",
  "keyFindings": ["string"],
  "riskFactors": ["string"],
  "triageTimestamp": "ISO 8601"
}
```

---

### `POST /api/escalate`
Triggers downstream compliance actions based on triage verdict and severity.

**Request**
```json
{ "alert": SuspiciousAlert, "triage": TriageResult }
```

**Response**
```json
{ "actions": EscalationAction[] }
```

---

## Deployment (Vercel)

```bash
npx vercel --prod
```

Add the environment variable in the Vercel dashboard:

**Settings → Environment Variables → Add**

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` |

The app deploys with zero configuration — all API routes are serverless functions.

---

## Example System Output

```
Alert ID:   TRD-2026-0042
Timestamp:  2026-06-06 09:47:33 UTC
Trader:     T-4821
Instrument: HDFC Bank (NSE: HDFCBANK)
Severity:   HIGH
Pattern:    Layering / Order Book Manipulation

Trader T-4821 placed 14 large BUY orders (avg 50,000 shares) between
09:44–09:47. 12 of 14 orders cancelled within 800ms of placement.
2 SELL orders executed at elevated price during cancellation window.

AI Triage (Claude claude-sonnet-4-6):
  The order pattern is consistent with layering: large visible orders
  inflate perceived demand, inducing price movement, before cancellation
  enables a profitable sell-side fill.

  Cancellation ratio:  85.7%
  Median cancel time:  620ms
  Anomaly vs baseline: +4.2σ

  Verdict:     ESCALATE
  Confidence:  91%
  FP prob:     9%

Automated Actions:
  1. COMP-8812 created → Surveillance Desk L2
  2. Alert posted to #compliance-alerts (Slack)
  3. Trader T-4821 flagged → 72-hr enhanced monitoring
```

---

## Project Structure

```
trade-surveillance/
├── app/
│   ├── api/
│   │   ├── escalate/route.ts   # Task 4 — downstream workflows
│   │   ├── fetch-market/route.ts  # Yahoo Finance ingestion
│   │   ├── generate/route.ts   # Synthetic data generator
│   │   ├── triage/route.ts     # Task 3 — Claude AI triage
│   │   └── upload/route.ts     # File upload + CSV/JSON parser
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                # Main dashboard UI
├── lib/
│   ├── patternDetector.ts      # Task 2 — pattern detection engine
│   ├── tradeGenerator.ts       # Task 1 — synthetic scenario generator
│   └── types.ts                # Shared TypeScript interfaces
├── public/
│   └── sample-trades.csv       # Downloadable sample file
├── .env.local.example
└── package.json
```
