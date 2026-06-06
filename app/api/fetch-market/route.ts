import { NextRequest, NextResponse } from 'next/server';
import { TradeOrder } from '@/lib/types';
import { detectAllPatterns } from '@/lib/patternDetector';

let orderSeq = 90_000;
const nextId = () => `ORD-MKT-${String(++orderSeq).padStart(7, '0')}`;
const rndInt = (min: number, max: number) => Math.floor(Math.random() * (max - min) + min);
const POOL = ['T-MKT-001', 'T-MKT-002', 'T-MKT-003', 'T-MKT-004', 'T-MKT-005'];

async function fetchSymbol(symbol: string): Promise<TradeOrder[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=false`;

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${symbol}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result?.timestamp) throw new Error(`No candle data for ${symbol}`);

  const { timestamp, indicators } = result;
  const q = indicators?.quote?.[0];
  if (!q) throw new Error(`Missing quote data for ${symbol}`);

  const instrName = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
  const exchange = /\.BO$/i.test(symbol) ? 'BSE' : 'NSE';
  const trades: TradeOrder[] = [];

  for (let i = 0; i < timestamp.length; i++) {
    const vol = q.volume?.[i];
    const closeP = q.close?.[i];
    const openP = q.open?.[i] ?? closeP;
    const highP = q.high?.[i] ?? closeP;
    const lowP = q.low?.[i] ?? closeP;
    if (!vol || !closeP) continue;

    const candle_ts = new Date(timestamp[i] * 1000);
    const isBullish = closeP >= openP;
    const numOrders = Math.min(rndInt(2, 6), Math.max(1, Math.floor(vol / 5_000)));
    const baseVol = Math.max(1, Math.floor(vol / numOrders));
    const priceRange = highP - lowP;

    for (let j = 0; j < numOrders; j++) {
      const ts = new Date(candle_ts.getTime() + j * Math.floor(60_000 / numOrders));
      const price = parseFloat(
        Math.max(0.01, lowP + priceRange * (j / Math.max(numOrders - 1, 1))).toFixed(2),
      );
      const isCancelled = Math.random() < 0.07;
      const cancelDelay = rndInt(1_500, 45_000);

      trades.push({
        orderId: nextId(),
        traderId: POOL[j % POOL.length],
        instrument: instrName,
        exchange,
        orderType: isBullish ? 'BUY' : 'SELL',
        quantity: baseVol + rndInt(-Math.floor(baseVol * 0.1), Math.floor(baseVol * 0.1)),
        price,
        timestamp: ts.toISOString(),
        status: isCancelled ? 'CANCELLED' : 'EXECUTED',
        cancelledAt: isCancelled
          ? new Date(ts.getTime() + cancelDelay).toISOString()
          : undefined,
        executedPrice: isCancelled ? undefined : parseFloat(closeP.toFixed(2)),
        isSuspicious: false,
      });
    }
  }

  return trades;
}

export async function POST(request: NextRequest) {
  try {
    const { symbols }: { symbols: string[] } = await request.json();

    if (!symbols?.length) {
      return NextResponse.json({ error: 'No symbols provided' }, { status: 400 });
    }
    if (symbols.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 symbols per request' }, { status: 400 });
    }

    const results = await Promise.allSettled(symbols.map(fetchSymbol));
    const allTrades: TradeOrder[] = [];
    const warnings: string[] = [];

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        allTrades.push(...r.value);
      } else {
        warnings.push(`${symbols[i]}: ${r.reason?.message ?? 'fetch failed'}`);
      }
    });

    if (allTrades.length === 0) {
      return NextResponse.json(
        { error: `No data retrieved. ${warnings.join(' | ')}` },
        { status: 422 },
      );
    }

    allTrades.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const alerts = detectAllPatterns(allTrades);
    const goodSymbols = symbols.filter((_, i) => results[i].status === 'fulfilled');

    return NextResponse.json({
      trades: allTrades,
      alerts,
      source: 'market',
      symbols: goodSymbols,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (err) {
    console.error('Market fetch error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Market fetch failed' },
      { status: 500 },
    );
  }
}
