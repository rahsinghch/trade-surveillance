import { NextRequest, NextResponse } from 'next/server';
import { TradeOrder } from '@/lib/types';
import { detectAllPatterns } from '@/lib/patternDetector';

function parseCSV(text: string): TradeOrder[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const raw = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
  const col = (aliases: string[]) => raw.findIndex(h => aliases.includes(h));

  const iOrder = col(['orderid', 'order_id', 'order id', 'id']);
  const iTrader = col(['traderid', 'trader_id', 'trader id', 'trader', 'account']);
  const iInstrument = col(['instrument', 'symbol', 'ticker', 'stock']);
  const iExchange = col(['exchange', 'market', 'exch']);
  const iType = col(['ordertype', 'order_type', 'order type', 'type', 'side']);
  const iQty = col(['quantity', 'qty', 'volume', 'size', 'shares']);
  const iPrice = col(['price', 'limitprice', 'limit_price', 'px']);
  const iTs = col(['timestamp', 'time', 'datetime', 'date', 'ts']);
  const iStatus = col(['status', 'state']);
  const iCancelAt = col(['cancelledat', 'cancelled_at', 'cancelled at', 'cancelat', 'cancel_at']);

  const trades: TradeOrder[] = [];
  let seq = 70000;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const v = line.split(',').map(s => s.trim());

    const qty = parseInt(v[iQty] ?? '0', 10);
    const price = parseFloat(v[iPrice] ?? '0');
    if (!qty || !price) continue;

    const rawStatus = (v[iStatus] ?? 'EXECUTED').toUpperCase();
    const status: TradeOrder['status'] = rawStatus.startsWith('CANCEL')
      ? 'CANCELLED'
      : rawStatus === 'PLACED'
      ? 'PLACED'
      : 'EXECUTED';

    trades.push({
      orderId: v[iOrder] ?? `ORD-UP-${String(++seq).padStart(6, '0')}`,
      traderId: v[iTrader] ?? 'T-UNKNOWN',
      instrument: (v[iInstrument] ?? 'UNKNOWN').toUpperCase(),
      exchange: (v[iExchange] ?? 'NSE').toUpperCase(),
      orderType: (v[iType] ?? 'BUY').toUpperCase().startsWith('S') ? 'SELL' : 'BUY',
      quantity: qty,
      price,
      timestamp: v[iTs] ?? new Date().toISOString(),
      status,
      cancelledAt:
        status === 'CANCELLED' && iCancelAt >= 0 && v[iCancelAt]
          ? v[iCancelAt]
          : undefined,
      isSuspicious: false,
    });
  }

  return trades;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 15 MB)' }, { status: 400 });
    }

    const text = await file.text();
    const name = file.name.toLowerCase();
    let trades: TradeOrder[];

    if (name.endsWith('.json')) {
      const parsed = JSON.parse(text);
      trades = Array.isArray(parsed) ? parsed : (parsed.trades ?? []);
    } else if (name.endsWith('.csv')) {
      trades = parseCSV(text);
    } else {
      return NextResponse.json(
        { error: 'Unsupported format — upload a .csv or .json file' },
        { status: 400 },
      );
    }

    if (trades.length === 0) {
      return NextResponse.json({ error: 'No valid trades found in file' }, { status: 422 });
    }

    const alerts = detectAllPatterns(trades);
    return NextResponse.json({ trades, alerts, source: 'upload', fileName: file.name });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process file' },
      { status: 500 },
    );
  }
}
