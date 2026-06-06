import { TradeOrder, SuspiciousAlert, SeverityLevel } from './types';

let alertSeq = 200;
const nextAlertId = () => `TRD-${new Date().getFullYear()}-D${String(alertSeq++).padStart(4, '0')}`;

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ── LAYERING ─────────────────────────────────────────────────────────────────
// Dominant side: many orders, high cancel rate, rapid cancels, opposite side executed
function detectLayering(trades: TradeOrder[]): SuspiciousAlert[] {
  const alerts: SuspiciousAlert[] = [];
  const seen = new Set<string>();

  for (const [key, orders] of groupBy(trades, t => `${t.traderId}|${t.instrument}`)) {
    if (seen.has(key)) continue;
    const sorted = [...orders].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    for (let i = 0; i < sorted.length; i++) {
      const wStart = new Date(sorted[i].timestamp).getTime();
      const window = sorted.filter(o => {
        const t = new Date(o.timestamp).getTime();
        return t >= wStart && t <= wStart + 5 * 60_000;
      });

      if (window.length < 5) continue;

      const buys = window.filter(o => o.orderType === 'BUY');
      const sells = window.filter(o => o.orderType === 'SELL');
      const dominant = buys.length >= sells.length ? buys : sells;
      const opposite = buys.length >= sells.length ? sells : buys;

      const cancelled = dominant.filter(o => o.status === 'CANCELLED');
      const cancelRatio = cancelled.length / dominant.length;
      if (cancelRatio < 0.6 || dominant.length < 4) continue;

      const cancelTimes = cancelled
        .filter(o => o.cancelledAt)
        .map(o => new Date(o.cancelledAt!).getTime() - new Date(o.timestamp).getTime());

      if (cancelTimes.filter(t => t < 2000).length < cancelled.length * 0.35) continue;
      if (!opposite.some(o => o.status === 'EXECUTED')) continue;

      seen.add(key);
      const med = median(cancelTimes);
      const severity: SeverityLevel = cancelRatio > 0.8 && dominant.length >= 6 ? 'HIGH' : 'MEDIUM';

      alerts.push({
        alertId: nextAlertId(),
        traderId: sorted[0].traderId,
        instrument: sorted[0].instrument,
        exchange: sorted[0].exchange,
        patternType: 'LAYERING',
        severity,
        detectedAt: new Date().toISOString(),
        orderCount: window.length,
        metrics: {
          cancellationRatio: parseFloat(cancelRatio.toFixed(3)),
          medianTimeToCancel: Math.round(med),
          anomalyScore: parseFloat((2.0 + (cancelRatio - 0.6) * 8).toFixed(1)),
          totalOrders: window.length,
        },
        description: `Trader ${sorted[0].traderId} placed ${dominant.length} ${dominant[0]?.orderType} orders for ${sorted[0].instrument}, ${cancelled.length} cancelled (${(cancelRatio * 100).toFixed(0)}% rate, median ${Math.round(med)}ms). ${opposite.filter(o => o.status === 'EXECUTED').length} opposite-side order(s) executed.`,
        status: 'PENDING',
      });
      break;
    }
  }

  return alerts;
}

// ── SPOOFING ─────────────────────────────────────────────────────────────────
// Ultra-rapid cancellations (<1 s) of large orders, then fills on opposite side
function detectSpoofing(trades: TradeOrder[]): SuspiciousAlert[] {
  const alerts: SuspiciousAlert[] = [];
  const seen = new Set<string>();

  for (const [key, orders] of groupBy(trades, t => `${t.traderId}|${t.instrument}`)) {
    if (seen.has(key)) continue;
    const sorted = [...orders].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    for (let i = 0; i < sorted.length; i++) {
      const wStart = new Date(sorted[i].timestamp).getTime();
      const window = sorted.filter(o => {
        const t = new Date(o.timestamp).getTime();
        return t >= wStart && t <= wStart + 3 * 60_000;
      });

      if (window.length < 4) continue;

      const buys = window.filter(o => o.orderType === 'BUY');
      const sells = window.filter(o => o.orderType === 'SELL');
      const dominant = buys.length >= sells.length ? buys : sells;
      const opposite = buys.length >= sells.length ? sells : buys;

      const cancelledDom = dominant.filter(o => o.status === 'CANCELLED' && o.cancelledAt);
      const ultraRapid = cancelledDom.filter(
        o => new Date(o.cancelledAt!).getTime() - new Date(o.timestamp).getTime() < 1000,
      );

      if (ultraRapid.length < 3) continue;
      if (ultraRapid.length / Math.max(dominant.length, 1) < 0.5) continue;
      if (!opposite.some(o => o.status === 'EXECUTED')) continue;

      seen.add(key);
      const cancelTimes = cancelledDom.map(
        o => new Date(o.cancelledAt!).getTime() - new Date(o.timestamp).getTime(),
      );

      alerts.push({
        alertId: nextAlertId(),
        traderId: sorted[0].traderId,
        instrument: sorted[0].instrument,
        exchange: sorted[0].exchange,
        patternType: 'SPOOFING',
        severity: ultraRapid.length >= 5 ? 'HIGH' : 'MEDIUM',
        detectedAt: new Date().toISOString(),
        orderCount: window.length,
        metrics: {
          cancellationRatio: parseFloat((cancelledDom.length / dominant.length).toFixed(3)),
          medianTimeToCancel: Math.round(median(cancelTimes)),
          anomalyScore: parseFloat((2.5 + ultraRapid.length * 0.2).toFixed(1)),
          totalOrders: window.length,
        },
        description: `Trader ${sorted[0].traderId} placed ${dominant.length} large ${dominant[0]?.orderType} orders for ${sorted[0].instrument}, ${ultraRapid.length} cancelled sub-1s (spoofing signature). ${opposite.filter(o => o.status === 'EXECUTED').length} opposite-side fill(s) at distorted price.`,
        status: 'PENDING',
      });
      break;
    }
  }

  return alerts;
}

// ── WASH TRADING ─────────────────────────────────────────────────────────────
// Matched round-trip executions between two traders within 2-minute windows
function detectWashTrading(trades: TradeOrder[]): SuspiciousAlert[] {
  const alerts: SuspiciousAlert[] = [];
  const seen = new Set<string>();

  for (const [instrument, instrTrades] of groupBy(trades, t => t.instrument)) {
    const executed = instrTrades.filter(t => t.status === 'EXECUTED');
    const buys = executed.filter(t => t.orderType === 'BUY');
    const sells = executed.filter(t => t.orderType === 'SELL');

    const pairCounts = new Map<string, { count: number; trds: TradeOrder[]; exchange: string }>();

    for (const b of buys) {
      for (const s of sells) {
        if (b.traderId === s.traderId) continue;
        if (Math.abs(new Date(b.timestamp).getTime() - new Date(s.timestamp).getTime()) > 2 * 60_000) continue;
        const qtyRatio = Math.min(b.quantity, s.quantity) / Math.max(b.quantity, s.quantity);
        if (qtyRatio < 0.75) continue;
        const priceRatio = Math.min(b.price, s.price) / Math.max(b.price, s.price);
        if (priceRatio < 0.993) continue;

        const pk = [b.traderId, s.traderId].sort().join('||') + '||' + instrument;
        if (!pairCounts.has(pk)) pairCounts.set(pk, { count: 0, trds: [], exchange: b.exchange });
        const e = pairCounts.get(pk)!;
        e.count++;
        if (!e.trds.includes(b)) e.trds.push(b);
        if (!e.trds.includes(s)) e.trds.push(s);
      }
    }

    for (const [pk, data] of pairCounts) {
      if (data.count < 3) continue;
      const [t1, t2] = pk.split('||').slice(0, 2);
      const pid = `${t1}|${instrument}`;
      if (seen.has(pid)) continue;
      seen.add(pid);

      const totalVol = data.trds.reduce((s, t) => s + t.quantity, 0);
      const avgVol = executed.reduce((s, t) => s + t.quantity, 0) / Math.max(executed.length, 1);

      alerts.push({
        alertId: nextAlertId(),
        traderId: `${t1} / ${t2}`,
        instrument,
        exchange: data.exchange,
        patternType: 'WASH_TRADING',
        severity: data.count >= 5 ? 'CRITICAL' : 'HIGH',
        detectedAt: new Date().toISOString(),
        orderCount: data.trds.length,
        metrics: {
          selfTradingRatio: parseFloat(
            Math.min(data.count / Math.max(buys.length, 1), 1).toFixed(2),
          ),
          totalOrders: data.trds.length,
          volumeMultiple: parseFloat((totalVol / Math.max(avgVol * 2, 1)).toFixed(1)),
        },
        description: `Traders ${t1} and ${t2} executed ${data.count} matched round-trips for ${instrument} with near-identical quantities and prices within 2-min windows, creating artificial volume of ~${Math.round(totalVol / 1000)}K shares.`,
        status: 'PENDING',
      });
    }
  }

  return alerts;
}

// ── MOMENTUM IGNITION ────────────────────────────────────────────────────────
// Escalating same-direction orders followed by large reversal
function detectMomentumIgnition(trades: TradeOrder[]): SuspiciousAlert[] {
  const alerts: SuspiciousAlert[] = [];
  const seen = new Set<string>();

  for (const [key, orders] of groupBy(trades, t => `${t.traderId}|${t.instrument}`)) {
    if (seen.has(key)) continue;
    const executed = orders
      .filter(o => o.status === 'EXECUTED')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (executed.length < 6) continue;

    for (let i = 0; i < executed.length - 5; i++) {
      const seq = executed.slice(i, i + 5);
      const dir = seq[0].orderType;
      if (!seq.every(o => o.orderType === dir)) continue;

      const qtys = seq.map(o => o.quantity);
      const escalating = qtys.filter((q, j) => j === 0 || q >= qtys[j - 1] * 0.85).length;
      if (escalating < 4) continue;

      const tSpan =
        new Date(seq[seq.length - 1].timestamp).getTime() -
        new Date(seq[0].timestamp).getTime();
      if (tSpan > 3 * 60_000) continue;

      const seqEnd = new Date(seq[seq.length - 1].timestamp).getTime();
      const reversal = executed.find(
        o =>
          new Date(o.timestamp).getTime() > seqEnd &&
          new Date(o.timestamp).getTime() < seqEnd + 5 * 60_000 &&
          o.orderType !== dir &&
          o.quantity >= qtys[qtys.length - 1] * 1.5,
      );

      if (!reversal) continue;
      seen.add(key);

      const avgQty = qtys.reduce((s, q) => s + q, 0) / qtys.length;

      alerts.push({
        alertId: nextAlertId(),
        traderId: seq[0].traderId,
        instrument: seq[0].instrument,
        exchange: seq[0].exchange,
        patternType: 'MOMENTUM_IGNITION',
        severity: 'MEDIUM',
        detectedAt: new Date().toISOString(),
        orderCount: seq.length + 1,
        metrics: {
          totalOrders: seq.length + 1,
          volumeMultiple: parseFloat((reversal.quantity / avgQty).toFixed(1)),
          priceImpact: parseFloat(
            (((reversal.price - seq[0].price) / seq[0].price) * 100).toFixed(2),
          ),
        },
        description: `Trader ${seq[0].traderId} executed ${seq.length} escalating ${dir} orders for ${seq[0].instrument} (avg ${Math.round(avgQty / 1000)}K, ${Math.round(tSpan / 1000)}s span), then reversed with ${Math.round(reversal.quantity / 1000)}K ${reversal.orderType} — possible self-ignited momentum exit.`,
        status: 'PENDING',
      });
      break;
    }
  }

  return alerts;
}

export function detectAllPatterns(trades: TradeOrder[]): SuspiciousAlert[] {
  const results = [
    ...detectLayering(trades),
    ...detectSpoofing(trades),
    ...detectWashTrading(trades),
    ...detectMomentumIgnition(trades),
  ];
  return results.slice(0, 25);
}
