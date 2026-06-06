import { NextResponse } from 'next/server';
import { generateTradingSession } from '@/lib/tradeGenerator';

export async function POST() {
  try {
    const { trades, alerts } = generateTradingSession();
    return NextResponse.json({ trades, alerts });
  } catch (err) {
    console.error('Generate error:', err);
    return NextResponse.json({ error: 'Failed to generate trading session' }, { status: 500 });
  }
}
