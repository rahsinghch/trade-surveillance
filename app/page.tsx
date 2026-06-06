'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  TradeOrder,
  SuspiciousAlert,
  TriageResult,
  EscalationAction,
  SeverityLevel,
  TriageVerdict,
  ActionType,
  PatternType,
} from '@/lib/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const SEVERITY_BG: Record<SeverityLevel, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-yellow-500',
  LOW: 'bg-green-500',
};
const SEVERITY_TEXT: Record<SeverityLevel, string> = {
  CRITICAL: 'text-red-400',
  HIGH: 'text-orange-400',
  MEDIUM: 'text-yellow-400',
  LOW: 'text-green-400',
};
const SEVERITY_BORDER: Record<SeverityLevel, string> = {
  CRITICAL: 'border-red-500/40',
  HIGH: 'border-orange-500/40',
  MEDIUM: 'border-yellow-500/40',
  LOW: 'border-green-500/40',
};
const VERDICT_STYLE: Record<TriageVerdict, { bg: string; text: string; label: string }> = {
  ESCALATE: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'ESCALATE' },
  MONITOR: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'MONITOR' },
  FALSE_POSITIVE: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'FALSE POSITIVE' },
};
const PATTERN_LABELS: Record<PatternType, string> = {
  LAYERING: 'Layering',
  SPOOFING: 'Spoofing',
  WASH_TRADING: 'Wash Trading',
  FRONT_RUNNING: 'Front Running',
  MOMENTUM_IGNITION: 'Momentum Ignition',
};
const ACTION_ICONS: Record<ActionType, string> = {
  JIRA_CASE: '📋',
  SLACK_NOTIFICATION: '💬',
  WATCHLIST_FLAG: '🚩',
  EMAIL_ALERT: '📧',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return iso.substring(11, 19) + ' UTC';
}
function fmtPrice(p: number) {
  return '₹' + p.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtQty(q: number) {
  if (q >= 100_000) return (q / 100_000).toFixed(1) + 'L';
  if (q >= 1_000) return (q / 1_000).toFixed(1) + 'K';
  return q.toString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: SeverityLevel }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${SEVERITY_BG[severity]} text-white`}>
      {severity}
    </span>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  color = 'text-slate-100',
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [allTrades, setAllTrades] = useState<TradeOrder[]>([]);
  const [displayedTrades, setDisplayedTrades] = useState<TradeOrder[]>([]);
  const [alerts, setAlerts] = useState<SuspiciousAlert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [triageMap, setTriageMap] = useState<Record<string, TriageResult>>({});
  const [triagingId, setTriagingId] = useState<string | null>(null);
  const [escalationLog, setEscalationLog] = useState<EscalationAction[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(5); // trades per tick
  const [clock, setClock] = useState('');
  const [autoTriageRunning, setAutoTriageRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'synthetic' | 'upload' | 'market'>('synthetic');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [marketSymbols, setMarketSymbols] = useState('HDFCBANK.NS, RELIANCE.NS');
  const [isUploading, setIsUploading] = useState(false);
  const [isFetchingMarket, setIsFetchingMarket] = useState(false);

  const replayIdxRef = useRef(0);
  const replayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC'), 1000);
    return () => clearInterval(id);
  }, []);

  // Trade replay engine
  useEffect(() => {
    if (!isReplaying) return;

    const tick = () => {
      const idx = replayIdxRef.current;
      if (idx >= allTrades.length) {
        setIsReplaying(false);
        return;
      }
      const batch = allTrades.slice(idx, idx + replaySpeed);
      setDisplayedTrades(prev => [...prev, ...batch]);
      replayIdxRef.current += replaySpeed;
      replayRef.current = setTimeout(tick, 120);
    };

    replayRef.current = setTimeout(tick, 120);
    return () => {
      if (replayRef.current) clearTimeout(replayRef.current);
    };
  }, [isReplaying, allTrades, replaySpeed]);

  // Auto-scroll trade feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [displayedTrades]);

  // Auto-scroll escalation log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [escalationLog]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setError(null);
    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate', { method: 'POST' });
      if (!res.ok) throw new Error('Generate request failed');
      const data = await res.json();
      setAllTrades(data.trades);
      setAlerts(data.alerts);
      setDisplayedTrades([]);
      setTriageMap({});
      setEscalationLog([]);
      setSelectedAlertId(null);
      replayIdxRef.current = 0;
      setIsReplaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate data');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTriage = useCallback(
    async (alert: SuspiciousAlert) => {
      if (triagingId || triageMap[alert.alertId]) return;
      setTriagingId(alert.alertId);
      setSelectedAlertId(alert.alertId);
      setAlerts(prev =>
        prev.map(a => (a.alertId === alert.alertId ? { ...a, status: 'TRIAGING' } : a)),
      );

      try {
        const res = await fetch('/api/triage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(alert),
        });
        if (!res.ok) throw new Error('Triage request failed');
        const triage: TriageResult = await res.json();

        setTriageMap(prev => ({ ...prev, [alert.alertId]: triage }));
        setAlerts(prev =>
          prev.map(a =>
            a.alertId === alert.alertId
              ? { ...a, status: triage.verdict === 'FALSE_POSITIVE' ? 'DISMISSED' : 'TRIAGED', triageResult: triage }
              : a,
          ),
        );

        // Auto-escalate if not FALSE_POSITIVE
        if (triage.verdict !== 'FALSE_POSITIVE') {
          const escRes = await fetch('/api/escalate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alert, triage }),
          });
          if (escRes.ok) {
            const { actions } = await escRes.json();
            setEscalationLog(prev => [...prev, ...actions]);
            setAlerts(prev =>
              prev.map(a =>
                a.alertId === alert.alertId && triage.verdict === 'ESCALATE'
                  ? { ...a, status: 'ESCALATED' }
                  : a,
              ),
            );
          }
        }
      } catch (e) {
        setAlerts(prev =>
          prev.map(a => (a.alertId === alert.alertId ? { ...a, status: 'PENDING' } : a)),
        );
        setError(e instanceof Error ? e.message : 'Triage failed');
      } finally {
        setTriagingId(null);
      }
    },
    [triagingId, triageMap],
  );

  const handleAutoTriage = async () => {
    if (autoTriageRunning) return;
    setAutoTriageRunning(true);
    const pending = alerts.filter(a => a.status === 'PENDING');
    for (const alert of pending) {
      await handleTriage(alert);
      await new Promise(r => setTimeout(r, 600));
    }
    setAutoTriageRunning(false);
  };

  const loadData = useCallback(
    (data: { trades: TradeOrder[]; alerts: SuspiciousAlert[] }) => {
      setAllTrades(data.trades);
      setAlerts(data.alerts);
      setDisplayedTrades([]);
      setTriageMap({});
      setEscalationLog([]);
      setSelectedAlertId(null);
      replayIdxRef.current = 0;
      setIsReplaying(true);
    },
    [],
  );

  const handleUpload = useCallback(async () => {
    if (!uploadFile) return;
    setError(null);
    setIsUploading(true);
    try {
      const form = new FormData();
      form.append('file', uploadFile);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? 'Upload failed'); }
      loadData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }, [uploadFile, loadData]);

  const handleFetchMarket = useCallback(async () => {
    if (!marketSymbols.trim()) return;
    setError(null);
    setIsFetchingMarket(true);
    try {
      const symbols = marketSymbols.split(',').map(s => s.trim()).filter(Boolean);
      const res = await fetch('/api/fetch-market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? 'Fetch failed'); }
      const data = await res.json();
      if (data.warnings?.length) setError(`${data.warnings.join(' | ')}`);
      loadData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Market fetch failed');
    } finally {
      setIsFetchingMarket(false);
    }
  }, [marketSymbols, loadData]);

  // ─── Derived stats ──────────────────────────────────────────────────────────

  const suspicious = displayedTrades.filter(t => t.isSuspicious).length;
  const high = alerts.filter(a => a.severity === 'HIGH' || a.severity === 'CRITICAL').length;
  const escalated = alerts.filter(a => a.status === 'ESCALATED').length;
  const dismissed = alerts.filter(a => a.status === 'DISMISSED').length;
  const selectedAlert = alerts.find(a => a.alertId === selectedAlertId) ?? null;
  const selectedTriage = selectedAlertId ? triageMap[selectedAlertId] : null;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">

      {/* ── Header ── */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white tracking-tight">🛡️ TradeGuard AI</span>
          <span className="text-slate-600">|</span>
          <div className="flex items-center gap-1.5">
            <LiveDot />
            <span className="text-green-400 text-xs font-semibold">LIVE</span>
          </div>
          <span className="text-slate-600 text-xs">NSE / BSE Market Surveillance</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span>{clock}</span>
          {allTrades.length > 0 && (
            <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-medium">
              Session: {allTrades.length} trades
            </span>
          )}
        </div>
      </header>

      {/* ── Stats Row ── */}
      <div className="px-4 pt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Alerts"
          value={alerts.length}
          sub={`${suspicious} suspicious trades`}
          color="text-blue-400"
        />
        <StatCard
          label="High / Critical"
          value={high}
          sub={`${alerts.length - high} medium / low`}
          color="text-orange-400"
        />
        <StatCard
          label="Escalated"
          value={escalated}
          sub={`${alerts.filter(a => a.status === 'TRIAGED').length} in triage`}
          color="text-red-400"
        />
        <StatCard
          label="False Positives"
          value={dismissed}
          sub={dismissed + escalated > 0 ? `${Math.round((dismissed / (dismissed + escalated || 1)) * 100)}% FP rate` : 'awaiting triage'}
          color="text-green-400"
        />
      </div>

      {/* ── Data Source Controls ── */}
      <div className="px-4 pt-3 space-y-2">

        {/* Tab bar */}
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit">
          {([
            ['synthetic', '⚡', 'Synthetic Data'],
            ['upload',    '📁', 'Upload File'],
            ['market',    '🌐', 'Market Feed'],
          ] as const).map(([mode, icon, label]) => (
            <button
              key={mode}
              onClick={() => { setDataSource(mode); setError(null); }}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                dataSource === mode
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Synthetic */}
        {dataSource === 'synthetic' && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || isReplaying}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
            >
              {isGenerating ? <><span className="animate-spin">⟳</span> Generating…</> : isReplaying ? <><span className="animate-pulse">▶</span> Replaying…</> : '⚡ Generate Trade Dataset'}
            </button>
            {alerts.length > 0 && (
              <button
                onClick={handleAutoTriage}
                disabled={autoTriageRunning || triagingId !== null || alerts.every(a => a.status !== 'PENDING')}
                className="bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                {autoTriageRunning ? '🤖 Auto-triaging…' : '🤖 Auto-Triage All'}
              </button>
            )}
          </div>
        )}

        {/* Upload */}
        {dataSource === 'upload' && (
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="border-2 border-dashed border-slate-700 hover:border-slate-500 rounded-lg px-4 py-2.5 cursor-pointer transition-colors min-w-64"
              onClick={() => fileInputRef.current?.click()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setUploadFile(f); }}
              onDragOver={e => e.preventDefault()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                className="hidden"
                onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
              />
              {uploadFile ? (
                <span className="text-sm text-slate-200">
                  📄 {uploadFile.name}
                  <span className="text-slate-500 text-xs ml-2">({(uploadFile.size / 1024).toFixed(1)} KB)</span>
                </span>
              ) : (
                <span className="text-sm text-slate-500">
                  Drop <span className="text-slate-400">CSV</span> / <span className="text-slate-400">JSON</span> here or <span className="text-blue-400 underline">browse</span>
                </span>
              )}
            </div>
            <button
              onClick={handleUpload}
              disabled={!uploadFile || isUploading}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              {isUploading ? '⟳ Processing…' : '▶ Ingest File'}
            </button>
            <a href="/sample-trades.csv" download className="text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors">
              ↓ Sample CSV
            </a>
            {alerts.length > 0 && (
              <button
                onClick={handleAutoTriage}
                disabled={autoTriageRunning || triagingId !== null || alerts.every(a => a.status !== 'PENDING')}
                className="bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold"
              >
                {autoTriageRunning ? '🤖 Auto-triaging…' : '🤖 Auto-Triage All'}
              </button>
            )}
            <p className="text-[10px] text-slate-600 w-full mt-0.5">
              CSV columns: orderId, traderId, instrument, exchange, orderType, quantity, price, timestamp, status, cancelledAt
            </p>
          </div>
        )}

        {/* Market Feed */}
        {dataSource === 'market' && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={marketSymbols}
              onChange={e => setMarketSymbols(e.target.value)}
              placeholder="HDFCBANK.NS, RELIANCE.NS, TCS.NS"
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 w-80 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleFetchMarket}
              disabled={isFetchingMarket || !marketSymbols.trim()}
              className="bg-teal-700 hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
            >
              {isFetchingMarket ? <><span className="animate-spin">⟳</span> Fetching…</> : '🌐 Fetch Live Data'}
            </button>
            <span className="text-xs text-slate-500">
              Yahoo Finance · NSE: <code className="text-slate-400">.NS</code> · BSE: <code className="text-slate-400">.BO</code> · max 5 symbols
            </span>
            {alerts.length > 0 && (
              <button
                onClick={handleAutoTriage}
                disabled={autoTriageRunning || triagingId !== null || alerts.every(a => a.status !== 'PENDING')}
                className="bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold"
              >
                {autoTriageRunning ? '🤖 Auto-triaging…' : '🤖 Auto-Triage All'}
              </button>
            )}
          </div>
        )}

        {/* Shared: replay progress + error */}
        {(isReplaying || error) && (
          <div className="flex flex-wrap items-center gap-3">
            {isReplaying && (
              <>
                <span className="text-slate-500 text-xs">{displayedTrades.length} / {allTrades.length} trades</span>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>Speed:</span>
                  {[1, 5, 10].map(s => (
                    <button
                      key={s}
                      onClick={() => setReplaySpeed(s)}
                      className={`px-2 py-1 rounded transition-colors ${replaySpeed === s ? 'bg-slate-600 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </>
            )}
            {error && <span className="text-red-400 text-xs bg-red-500/10 px-3 py-1 rounded-full">⚠ {error}</span>}
          </div>
        )}

      </div>

      {/* ── Main Three-Column Layout ── */}
      <div className="flex-1 px-4 pt-3 pb-4 grid grid-cols-1 lg:grid-cols-3 gap-3" style={{ minHeight: 0 }}>

        {/* ── Column 1: Trade Feed ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              📊 Trade Feed
            </h2>
            <span className="text-xs text-slate-500">{displayedTrades.length} entries</span>
          </div>

          {displayedTrades.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
              {allTrades.length === 0 ? 'Click "Generate Trade Dataset" to begin' : 'Loading…'}
            </div>
          ) : (
            <div ref={feedRef} className="flex-1 overflow-y-auto p-2 space-y-1">
              {displayedTrades.slice(-200).map(trade => (
                <div
                  key={trade.orderId}
                  className={`px-2 py-1.5 rounded text-xs border ${
                    trade.isSuspicious
                      ? 'bg-amber-500/10 border-amber-500/30 animate-fade-in'
                      : 'bg-slate-800/50 border-slate-700/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-bold text-[10px] px-1 rounded ${
                          trade.orderType === 'BUY' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {trade.orderType}
                      </span>
                      <span className="font-semibold text-slate-200">{trade.instrument}</span>
                      <span className="text-slate-400">{fmtQty(trade.quantity)}</span>
                    </div>
                    <span className="text-slate-500 text-[10px]">{fmtTime(trade.timestamp)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-slate-300">{fmtPrice(trade.price)}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500 text-[10px]">{trade.traderId}</span>
                      {trade.status === 'CANCELLED' && (
                        <span className="text-[9px] bg-slate-700 text-slate-400 px-1 rounded">CXLD</span>
                      )}
                      {trade.isSuspicious && (
                        <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1 rounded font-bold">⚠ FLAGGED</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Column 2: Alerts Panel ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              🚨 Detected Alerts
            </h2>
            <span className="text-xs text-slate-500">{alerts.length} patterns</span>
          </div>

          {alerts.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
              No alerts — generate data to begin
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {alerts.map(alert => {
                const triage = triageMap[alert.alertId];
                const isSelected = selectedAlertId === alert.alertId;
                const isTriaging = triagingId === alert.alertId;

                return (
                  <div
                    key={alert.alertId}
                    onClick={() => setSelectedAlertId(alert.alertId)}
                    className={`rounded-lg border p-2.5 cursor-pointer transition-all ${
                      isSelected
                        ? `${SEVERITY_BORDER[alert.severity]} bg-slate-800 ring-1 ring-blue-500/50`
                        : `${SEVERITY_BORDER[alert.severity]} bg-slate-800/50 hover:bg-slate-800`
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <SeverityBadge severity={alert.severity} />
                          <span className="text-[10px] font-mono text-slate-400">{alert.alertId}</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-200 mt-1">
                          {PATTERN_LABELS[alert.patternType]}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {alert.instrument} · {alert.traderId} · {alert.exchange}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {triage ? (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${VERDICT_STYLE[triage.verdict].bg} ${VERDICT_STYLE[triage.verdict].text}`}
                          >
                            {VERDICT_STYLE[triage.verdict].label}
                          </span>
                        ) : (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                              alert.status === 'PENDING'
                                ? 'bg-slate-700 text-slate-400'
                                : alert.status === 'TRIAGING'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-slate-700 text-slate-400'
                            }`}
                          >
                            {alert.status === 'TRIAGING' ? '⟳ Triaging…' : alert.status}
                          </span>
                        )}
                        {triage && (
                          <span className="text-[10px] text-slate-500">{triage.confidence}% conf.</span>
                        )}
                      </div>
                    </div>

                    {/* Metrics mini-row */}
                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      {alert.metrics.cancellationRatio !== undefined && (
                        <span className="text-[10px] text-slate-500">
                          CxlR: <span className="text-slate-300">{(alert.metrics.cancellationRatio * 100).toFixed(0)}%</span>
                        </span>
                      )}
                      {alert.metrics.anomalyScore !== undefined && (
                        <span className="text-[10px] text-slate-500">
                          σ: <span className="text-slate-300">+{alert.metrics.anomalyScore}</span>
                        </span>
                      )}
                      {alert.metrics.selfTradingRatio !== undefined && (
                        <span className="text-[10px] text-slate-500">
                          STR: <span className="text-slate-300">{(alert.metrics.selfTradingRatio * 100).toFixed(0)}%</span>
                        </span>
                      )}
                    </div>

                    {/* Triage button */}
                    {!triage && alert.status === 'PENDING' && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleTriage(alert);
                        }}
                        disabled={isTriaging || triagingId !== null}
                        className="mt-2 w-full text-[11px] bg-purple-700/60 hover:bg-purple-600 disabled:opacity-40 text-purple-200 py-1 rounded transition-colors font-medium"
                      >
                        {isTriaging ? '🤖 Analysing with Claude…' : '🤖 Triage with AI'}
                      </button>
                    )}

                    {/* Escalation indicator */}
                    {alert.status === 'ESCALATED' && (
                      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-red-400">
                        <span>🔴</span>
                        <span>Escalated · {escalationLog.filter(e => e.alertId === alert.alertId).length} actions triggered</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Column 3: AI Triage Panel ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              🤖 AI Triage Panel
            </h2>
            {selectedAlert && (
              <span className="text-[10px] font-mono text-slate-500">{selectedAlert.alertId}</span>
            )}
          </div>

          {!selectedAlert ? (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-sm text-center px-6">
              Select an alert from the panel to view AI analysis
            </div>
          ) : triagingId === selectedAlert.alertId ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-sm">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <p>Claude is analysing…</p>
              <p className="text-xs text-slate-600 max-w-48 text-center">
                Evaluating pattern metrics against market baselines
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Alert Header */}
              <div className={`rounded-lg border p-3 ${SEVERITY_BORDER[selectedAlert.severity]} bg-slate-800/50`}>
                <div className="flex items-center justify-between mb-1">
                  <SeverityBadge severity={selectedAlert.severity} />
                  <span className="text-xs text-slate-500">{fmtTime(selectedAlert.detectedAt)}</span>
                </div>
                <p className="text-sm font-bold text-slate-100 mt-1">
                  {PATTERN_LABELS[selectedAlert.patternType]}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedAlert.instrument} · {selectedAlert.traderId} · {selectedAlert.exchange}
                </p>
              </div>

              {/* Description */}
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Detected Pattern</p>
                <p className="text-xs text-slate-300 leading-relaxed">{selectedAlert.description}</p>
              </div>

              {/* Metrics */}
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Quantitative Metrics</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(selectedAlert.metrics).map(([k, v]) => {
                    if (v === undefined) return null;
                    const labels: Record<string, string> = {
                      cancellationRatio: 'Cancel Ratio',
                      medianTimeToCancel: 'Median CxlT',
                      anomalyScore: 'Anomaly σ',
                      totalOrders: 'Orders',
                      volumeMultiple: 'Vol Multiple',
                      priceImpact: 'Price Impact',
                      selfTradingRatio: 'Self-Trade',
                    };
                    const fmt =
                      k === 'cancellationRatio' || k === 'selfTradingRatio'
                        ? `${(v * 100).toFixed(1)}%`
                        : k === 'medianTimeToCancel'
                        ? `${v}ms`
                        : k === 'anomalyScore'
                        ? `+${v}σ`
                        : k === 'volumeMultiple'
                        ? `${v}x`
                        : k === 'priceImpact'
                        ? `${v > 0 ? '+' : ''}${v}%`
                        : String(v);
                    return (
                      <div key={k} className="bg-slate-800 rounded p-2">
                        <p className="text-[9px] text-slate-500 uppercase">{labels[k] ?? k}</p>
                        <p className="text-xs font-semibold text-slate-200 mt-0.5">{fmt}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AI Triage Result */}
              {selectedTriage ? (
                <>
                  <div className={`rounded-lg p-3 border ${VERDICT_STYLE[selectedTriage.verdict].bg} border-current`}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider">Triage Verdict</p>
                        <p className={`text-lg font-bold mt-0.5 ${VERDICT_STYLE[selectedTriage.verdict].text}`}>
                          {VERDICT_STYLE[selectedTriage.verdict].label}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-400 uppercase">Detection Confidence</p>
                        <p className={`text-2xl font-bold mt-0.5 ${VERDICT_STYLE[selectedTriage.verdict].text}`}>
                          {selectedTriage.confidence}%
                        </p>
                      </div>
                    </div>
                    {/* Confidence bar */}
                    <div className="w-full bg-slate-700 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${
                          selectedTriage.verdict === 'ESCALATE'
                            ? 'bg-red-500'
                            : selectedTriage.verdict === 'MONITOR'
                            ? 'bg-yellow-500'
                            : 'bg-slate-500'
                        }`}
                        style={{ width: `${selectedTriage.confidence}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">AI Rationale</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{selectedTriage.rationale}</p>
                  </div>

                  {selectedTriage.keyFindings.length > 0 && (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Key Findings</p>
                      <ul className="space-y-1">
                        {selectedTriage.keyFindings.map((f, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
                            <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selectedTriage.riskFactors.length > 0 && (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Risk Factors</p>
                      <ul className="space-y-1">
                        {selectedTriage.riskFactors.map((r, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-red-300">
                            <span className="mt-0.5 shrink-0">⚠</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="text-[10px] text-slate-600">
                    Triaged by Claude claude-sonnet-4-6 · {fmtTime(selectedTriage.triageTimestamp)}
                  </p>
                </>
              ) : (
                selectedAlert.status === 'PENDING' && (
                  <button
                    onClick={() => handleTriage(selectedAlert)}
                    disabled={triagingId !== null}
                    className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors"
                  >
                    🤖 Run AI Triage with Claude
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Escalation Log ── */}
      <div className="px-4 pb-4">
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              ⚡ Automated Escalation Log
            </h2>
            <span className="text-xs text-slate-500">{escalationLog.length} actions triggered</span>
          </div>

          {escalationLog.length === 0 ? (
            <div className="py-4 text-center text-slate-600 text-xs">
              Escalation actions will appear here after AI triage
            </div>
          ) : (
            <div ref={logRef} className="overflow-x-auto max-h-36 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-slate-500 text-[10px] uppercase tracking-wider border-b border-slate-800">
                    <th className="text-left px-3 py-1.5">Action</th>
                    <th className="text-left px-3 py-1.5">Alert</th>
                    <th className="text-left px-3 py-1.5">Result</th>
                    <th className="text-left px-3 py-1.5">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {escalationLog.map(action => (
                    <tr key={action.actionId} className="border-b border-slate-800/50 hover:bg-slate-800/30 animate-fade-in">
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1">
                          <span>{ACTION_ICONS[action.actionType]}</span>
                          <span
                            className={`font-medium ${
                              action.actionType === 'JIRA_CASE'
                                ? 'text-blue-400'
                                : action.actionType === 'SLACK_NOTIFICATION'
                                ? 'text-purple-400'
                                : action.actionType === 'WATCHLIST_FLAG'
                                ? 'text-orange-400'
                                : 'text-yellow-400'
                            }`}
                          >
                            {action.actionType.replace('_', ' ')}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-slate-400">{action.alertId}</td>
                      <td className="px-3 py-1.5 text-slate-300 max-w-xs truncate">{action.result}</td>
                      <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{fmtTime(action.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
