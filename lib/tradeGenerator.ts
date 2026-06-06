import { TradeOrder, SuspiciousAlert } from './types';

const INSTRUMENTS = [
  { symbol: 'HDFCBANK', exchange: 'NSE', basePrice: 1520 },
  { symbol: 'RELIANCE', exchange: 'NSE', basePrice: 2840 },
  { symbol: 'INFY', exchange: 'BSE', basePrice: 1650 },
  { symbol: 'TCS', exchange: 'NSE', basePrice: 3890 },
  { symbol: 'WIPRO', exchange: 'NSE', basePrice: 480 },
  { symbol: 'ICICIBANK', exchange: 'NSE', basePrice: 1120 },
  { symbol: 'BHARTIARTL', exchange: 'NSE', basePrice: 1340 },
  { symbol: 'SBIN', exchange: 'BSE', basePrice: 820 },
];

const NORMAL_TRADERS = [
  'T-1001', 'T-1002', 'T-1003', 'T-1004', 'T-1005',
  'T-2001', 'T-2002', 'T-2003', 'T-3001', 'T-3002',
];

let orderSeq = 5000;
let alertSeq = 41;

const nextOrderId = () => `ORD-${String(++orderSeq).padStart(6, '0')}`;
const nextAlertId = () => `TRD-2026-${String(alertSeq++).padStart(4, '0')}`;
const rnd = (min: number, max: number) => Math.random() * (max - min) + min;
const rndInt = (min: number, max: number) => Math.floor(rnd(min, max));
const pick = <T>(arr: T[]): T => arr[rndInt(0, arr.length)];

function generateNormalTrades(baseTime: Date, count: number): TradeOrder[] {
  const trades: TradeOrder[] = [];
  for (let i = 0; i < count; i++) {
    const inst = pick(INSTRUMENTS);
    const placedAt = new Date(baseTime.getTime() + i * rndInt(8000, 45000));
    const cancelled = Math.random() < 0.12;
    trades.push({
      orderId: nextOrderId(),
      traderId: pick(NORMAL_TRADERS),
      instrument: inst.symbol,
      exchange: inst.exchange,
      orderType: Math.random() > 0.5 ? 'BUY' : 'SELL',
      quantity: rndInt(200, 8000),
      price: parseFloat((inst.basePrice * (1 + rnd(-0.008, 0.008))).toFixed(2)),
      timestamp: placedAt.toISOString(),
      status: cancelled ? 'CANCELLED' : 'EXECUTED',
      cancelledAt: cancelled
        ? new Date(placedAt.getTime() + rndInt(3000, 60000)).toISOString()
        : undefined,
      isSuspicious: false,
    });
  }
  return trades;
}

// --- Scenario 1: Layering (HIGH) ---
function generateLayering(baseTime: Date): { trades: TradeOrder[]; alert: SuspiciousAlert } {
  const inst = INSTRUMENTS[0]; // HDFCBANK
  const traderId = 'T-4821';
  const alertId = nextAlertId();
  const trades: TradeOrder[] = [];

  for (let i = 0; i < 14; i++) {
    const placedAt = new Date(baseTime.getTime() + i * 15_000);
    const cancelled = i < 12;
    trades.push({
      orderId: nextOrderId(),
      traderId,
      instrument: inst.symbol,
      exchange: inst.exchange,
      orderType: 'BUY',
      quantity: rndInt(40_000, 60_000),
      price: parseFloat((inst.basePrice + rnd(0, 4)).toFixed(2)),
      timestamp: placedAt.toISOString(),
      status: cancelled ? 'CANCELLED' : 'EXECUTED',
      cancelledAt: cancelled
        ? new Date(placedAt.getTime() + rndInt(380, 870)).toISOString()
        : undefined,
      isSuspicious: true,
      alertId,
    });
  }

  // 2 SELL orders executed at elevated price
  for (let i = 0; i < 2; i++) {
    const ts = new Date(baseTime.getTime() + (3 + i) * 60_000);
    const ep = parseFloat((inst.basePrice + rnd(7, 11)).toFixed(2));
    trades.push({
      orderId: nextOrderId(),
      traderId,
      instrument: inst.symbol,
      exchange: inst.exchange,
      orderType: 'SELL',
      quantity: rndInt(12_000, 18_000),
      price: ep,
      timestamp: ts.toISOString(),
      status: 'EXECUTED',
      executedPrice: ep,
      isSuspicious: true,
      alertId,
    });
  }

  const alert: SuspiciousAlert = {
    alertId,
    traderId,
    instrument: inst.symbol,
    exchange: inst.exchange,
    patternType: 'LAYERING',
    severity: 'HIGH',
    detectedAt: baseTime.toISOString(),
    orderCount: 16,
    metrics: {
      cancellationRatio: 0.857,
      medianTimeToCancel: 620,
      anomalyScore: 4.2,
      totalOrders: 16,
      priceImpact: 0.52,
    },
    description:
      `Trader ${traderId} placed 14 large BUY orders (avg 50,000 shares) between ` +
      `${fmtTime(baseTime)}–${fmtTime(new Date(baseTime.getTime() + 3 * 60_000))} UTC. ` +
      `12 of 14 orders cancelled within 800 ms of placement. ` +
      `2 SELL orders executed at elevated price (+0.52%) during the cancellation window.`,
    status: 'PENDING',
  };

  return { trades, alert };
}

// --- Scenario 2: Spoofing (HIGH) ---
function generateSpoofing(baseTime: Date): { trades: TradeOrder[]; alert: SuspiciousAlert } {
  const inst = INSTRUMENTS[1]; // RELIANCE
  const traderId = 'T-2934';
  const alertId = nextAlertId();
  const trades: TradeOrder[] = [];

  for (let i = 0; i < 8; i++) {
    const placedAt = new Date(baseTime.getTime() + i * 9_000);
    const cancelled = i < 7;
    trades.push({
      orderId: nextOrderId(),
      traderId,
      instrument: inst.symbol,
      exchange: inst.exchange,
      orderType: 'SELL',
      quantity: rndInt(25_000, 38_000),
      price: parseFloat((inst.basePrice - rnd(4, 9)).toFixed(2)),
      timestamp: placedAt.toISOString(),
      status: cancelled ? 'CANCELLED' : 'EXECUTED',
      cancelledAt: cancelled
        ? new Date(placedAt.getTime() + rndInt(180, 520)).toISOString()
        : undefined,
      isSuspicious: true,
      alertId,
    });
  }

  // BUY orders at deflated price
  for (let i = 0; i < 3; i++) {
    const ts = new Date(baseTime.getTime() + 90_000 + i * 6_000);
    const ep = parseFloat((inst.basePrice - rnd(14, 19)).toFixed(2));
    trades.push({
      orderId: nextOrderId(),
      traderId,
      instrument: inst.symbol,
      exchange: inst.exchange,
      orderType: 'BUY',
      quantity: rndInt(8_000, 14_000),
      price: ep,
      timestamp: ts.toISOString(),
      status: 'EXECUTED',
      executedPrice: ep,
      isSuspicious: true,
      alertId,
    });
  }

  const alert: SuspiciousAlert = {
    alertId,
    traderId,
    instrument: inst.symbol,
    exchange: inst.exchange,
    patternType: 'SPOOFING',
    severity: 'HIGH',
    detectedAt: baseTime.toISOString(),
    orderCount: 11,
    metrics: {
      cancellationRatio: 0.875,
      medianTimeToCancel: 340,
      anomalyScore: 3.8,
      totalOrders: 11,
      priceImpact: -0.58,
    },
    description:
      `Trader ${traderId} placed 8 large SELL orders for RELIANCE to artificially depress price. ` +
      `7 of 8 orders cancelled within 520 ms after achieving price impact of -0.58%. ` +
      `Subsequently executed 3 BUY orders at deflated price, gaining advantage from ` +
      `self-created market distortion.`,
    status: 'PENDING',
  };

  return { trades, alert };
}

// --- Scenario 3: Wash Trading (CRITICAL) ---
function generateWashTrading(baseTime: Date): { trades: TradeOrder[]; alert: SuspiciousAlert } {
  const inst = INSTRUMENTS[2]; // INFY
  const trader1 = 'T-1122';
  const trader2 = 'T-1123'; // related account
  const alertId = nextAlertId();
  const trades: TradeOrder[] = [];

  for (let i = 0; i < 6; i++) {
    const ts = new Date(baseTime.getTime() + i * 90_000);
    const qty = rndInt(15_000, 22_000);
    const price = parseFloat((inst.basePrice + rnd(-2, 2)).toFixed(2));

    trades.push({
      orderId: nextOrderId(),
      traderId: trader1,
      instrument: inst.symbol,
      exchange: inst.exchange,
      orderType: 'BUY',
      quantity: qty,
      price,
      timestamp: ts.toISOString(),
      status: 'EXECUTED',
      executedPrice: price,
      isSuspicious: true,
      alertId,
    });

    trades.push({
      orderId: nextOrderId(),
      traderId: trader2,
      instrument: inst.symbol,
      exchange: inst.exchange,
      orderType: 'SELL',
      quantity: qty,
      price,
      timestamp: new Date(ts.getTime() + rndInt(80, 400)).toISOString(),
      status: 'EXECUTED',
      executedPrice: price,
      isSuspicious: true,
      alertId,
    });
  }

  const alert: SuspiciousAlert = {
    alertId,
    traderId: `${trader1} / ${trader2}`,
    instrument: inst.symbol,
    exchange: inst.exchange,
    patternType: 'WASH_TRADING',
    severity: 'CRITICAL',
    detectedAt: baseTime.toISOString(),
    orderCount: 12,
    metrics: {
      selfTradingRatio: 0.94,
      anomalyScore: 5.1,
      totalOrders: 12,
      volumeMultiple: 3.2,
      cancellationRatio: 0,
    },
    description:
      `Traders ${trader1} and ${trader2} (suspected related accounts) executed 6 rounds of ` +
      `matching buy/sell orders for INFY on BSE. Trade-matching ratio 94% with near-identical ` +
      `quantities and minimal price variance. Creates artificial volume of ~108,000 shares ` +
      `with no genuine change in beneficial ownership.`,
    status: 'PENDING',
  };

  return { trades, alert };
}

// --- Scenario 4: Momentum Ignition (MEDIUM) ---
function generateMomentumIgnition(baseTime: Date): { trades: TradeOrder[]; alert: SuspiciousAlert } {
  const inst = INSTRUMENTS[3]; // TCS
  const traderId = 'T-8876';
  const alertId = nextAlertId();
  const trades: TradeOrder[] = [];

  for (let i = 0; i < 8; i++) {
    const ts = new Date(baseTime.getTime() + i * 3_500);
    const qty = rndInt(800, 1_500) * (i + 1);
    trades.push({
      orderId: nextOrderId(),
      traderId,
      instrument: inst.symbol,
      exchange: inst.exchange,
      orderType: 'BUY',
      quantity: qty,
      price: parseFloat((inst.basePrice + i * 0.6).toFixed(2)),
      timestamp: ts.toISOString(),
      status: 'EXECUTED',
      executedPrice: parseFloat((inst.basePrice + i * 0.6).toFixed(2)),
      isSuspicious: true,
      alertId,
    });
  }

  // Large dump after momentum established
  const sellTs = new Date(baseTime.getTime() + 40_000);
  const sellEp = parseFloat((inst.basePrice + 5.2).toFixed(2));
  trades.push({
    orderId: nextOrderId(),
    traderId,
    instrument: inst.symbol,
    exchange: inst.exchange,
    orderType: 'SELL',
    quantity: rndInt(55_000, 72_000),
    price: sellEp,
    timestamp: sellTs.toISOString(),
    status: 'EXECUTED',
    executedPrice: sellEp,
    isSuspicious: true,
    alertId,
  });

  const alert: SuspiciousAlert = {
    alertId,
    traderId,
    instrument: inst.symbol,
    exchange: inst.exchange,
    patternType: 'MOMENTUM_IGNITION',
    severity: 'MEDIUM',
    detectedAt: baseTime.toISOString(),
    orderCount: 9,
    metrics: {
      anomalyScore: 2.9,
      totalOrders: 9,
      priceImpact: 0.13,
      volumeMultiple: 2.1,
      cancellationRatio: 0,
    },
    description:
      `Trader ${traderId} executed 8 escalating BUY orders for TCS over 28 seconds, ` +
      `progressively increasing size (800→8,400 shares) to trigger algorithmic momentum. ` +
      `Subsequently sold 63,000 shares at inflated price (+0.13%), ` +
      `profiting from self-triggered price movement.`,
    status: 'PENDING',
  };

  return { trades, alert };
}

// --- Scenario 5: Front Running (CRITICAL) ---
function generateFrontRunning(baseTime: Date): { trades: TradeOrder[]; alert: SuspiciousAlert } {
  const inst = INSTRUMENTS[4]; // WIPRO
  const traderId = 'T-9901';
  const alertId = nextAlertId();
  const trades: TradeOrder[] = [];

  // Pre-positioning by suspected front-runner
  for (let i = 0; i < 5; i++) {
    const ts = new Date(baseTime.getTime() + i * 4_000);
    const price = parseFloat((inst.basePrice + rnd(-0.3, 0.3)).toFixed(2));
    trades.push({
      orderId: nextOrderId(),
      traderId,
      instrument: inst.symbol,
      exchange: inst.exchange,
      orderType: 'BUY',
      quantity: rndInt(5_000, 9_000),
      price,
      timestamp: ts.toISOString(),
      status: 'EXECUTED',
      executedPrice: price,
      isSuspicious: true,
      alertId,
    });
  }

  // Large institutional BUY arrives 30s later
  const instTs = new Date(baseTime.getTime() + 32_000);
  trades.push({
    orderId: nextOrderId(),
    traderId: 'T-INST-007',
    instrument: inst.symbol,
    exchange: inst.exchange,
    orderType: 'BUY',
    quantity: 500_000,
    price: parseFloat((inst.basePrice + 5.5).toFixed(2)),
    timestamp: instTs.toISOString(),
    status: 'EXECUTED',
    executedPrice: parseFloat((inst.basePrice + 5.5).toFixed(2)),
    isSuspicious: false,
  });

  // Front-runner's SELL after institutional order drives price up
  const sellTs = new Date(baseTime.getTime() + 50_000);
  const sellEp = parseFloat((inst.basePrice + 7.2).toFixed(2));
  trades.push({
    orderId: nextOrderId(),
    traderId,
    instrument: inst.symbol,
    exchange: inst.exchange,
    orderType: 'SELL',
    quantity: rndInt(28_000, 38_000),
    price: sellEp,
    timestamp: sellTs.toISOString(),
    status: 'EXECUTED',
    executedPrice: sellEp,
    isSuspicious: true,
    alertId,
  });

  const alert: SuspiciousAlert = {
    alertId,
    traderId,
    instrument: inst.symbol,
    exchange: inst.exchange,
    patternType: 'FRONT_RUNNING',
    severity: 'CRITICAL',
    detectedAt: baseTime.toISOString(),
    orderCount: 7,
    metrics: {
      anomalyScore: 4.8,
      totalOrders: 7,
      priceImpact: 1.5,
      volumeMultiple: 4.7,
      cancellationRatio: 0,
    },
    description:
      `Trader ${traderId} accumulated ~33,000 WIPRO shares over 5 tranches (32 seconds before) ` +
      `a 500,000-share institutional BUY (T-INST-007). Price rose +1.5% following institutional ` +
      `order execution. Front-runner sold position at elevated price, estimated gain ₹2.4 lakh. ` +
      `Possible access to pre-trade order flow information.`,
    status: 'PENDING',
  };

  return { trades, alert };
}

function fmtTime(d: Date): string {
  return d.toISOString().substring(11, 19);
}

export function generateTradingSession(): { trades: TradeOrder[]; alerts: SuspiciousAlert[] } {
  // Reset sequences for fresh datasets
  orderSeq = 5000 + rndInt(0, 500);
  alertSeq = 40 + rndInt(0, 5);

  const sessionStart = new Date('2026-06-06T09:15:00.000Z');

  const scenarios = [
    generateLayering(new Date(sessionStart.getTime() + 29 * 60_000)),
    generateSpoofing(new Date(sessionStart.getTime() + 75 * 60_000)),
    generateWashTrading(new Date(sessionStart.getTime() + 110 * 60_000)),
    generateMomentumIgnition(new Date(sessionStart.getTime() + 150 * 60_000)),
    generateFrontRunning(new Date(sessionStart.getTime() + 195 * 60_000)),
  ];

  const normalTrades = generateNormalTrades(sessionStart, 110);

  const allTrades = [
    ...normalTrades,
    ...scenarios.flatMap(s => s.trades),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return {
    trades: allTrades,
    alerts: scenarios.map(s => s.alert),
  };
}
