export type OrderType = 'BUY' | 'SELL';
export type OrderStatus = 'PLACED' | 'CANCELLED' | 'EXECUTED';
export type PatternType = 'LAYERING' | 'SPOOFING' | 'WASH_TRADING' | 'FRONT_RUNNING' | 'MOMENTUM_IGNITION';
export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TriageVerdict = 'ESCALATE' | 'MONITOR' | 'FALSE_POSITIVE';
export type AlertStatus = 'PENDING' | 'TRIAGING' | 'TRIAGED' | 'ESCALATED' | 'DISMISSED';
export type ActionType = 'JIRA_CASE' | 'SLACK_NOTIFICATION' | 'WATCHLIST_FLAG' | 'EMAIL_ALERT';

export interface TradeOrder {
  orderId: string;
  traderId: string;
  instrument: string;
  exchange: string;
  orderType: OrderType;
  quantity: number;
  price: number;
  timestamp: string;
  status: OrderStatus;
  cancelledAt?: string;
  executedPrice?: number;
  isSuspicious?: boolean;
  alertId?: string;
}

export interface AlertMetrics {
  cancellationRatio?: number;
  medianTimeToCancel?: number;
  anomalyScore?: number;
  totalOrders?: number;
  volumeMultiple?: number;
  priceImpact?: number;
  selfTradingRatio?: number;
}

export interface SuspiciousAlert {
  alertId: string;
  traderId: string;
  instrument: string;
  exchange: string;
  patternType: PatternType;
  severity: SeverityLevel;
  detectedAt: string;
  orderCount: number;
  metrics: AlertMetrics;
  description: string;
  status: AlertStatus;
  triageResult?: TriageResult;
}

export interface TriageResult {
  verdict: TriageVerdict;
  confidence: number;
  rationale: string;
  keyFindings: string[];
  riskFactors: string[];
  triageTimestamp: string;
}

export interface EscalationAction {
  actionId: string;
  alertId: string;
  actionType: ActionType;
  status: 'TRIGGERED' | 'FAILED';
  description: string;
  result: string;
  timestamp: string;
}

export interface GenerateResponse {
  trades: TradeOrder[];
  alerts: SuspiciousAlert[];
}

export interface TriageRequest {
  alert: SuspiciousAlert;
}

export interface EscalateRequest {
  alert: SuspiciousAlert;
  triage: TriageResult;
}

export interface EscalateResponse {
  actions: EscalationAction[];
}
