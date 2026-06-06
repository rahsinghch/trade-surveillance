import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { SuspiciousAlert, TriageResult, TriageVerdict } from '@/lib/types';

const SYSTEM_PROMPT = `You are an expert compliance analyst and trade surveillance specialist at a major financial institution. Your role is to analyse suspicious trading alerts and determine if they represent genuine market manipulation or false positives.

You have deep expertise in:
- Market microstructure and order-flow toxicity analysis
- Manipulation patterns: layering, spoofing, wash trading, momentum ignition, front running
- Regulatory frameworks: SEBI Circular SEBI/HO/MRD/MRD-PoD-1/P/CIR/2022/111, MiFID II Art 12, SEC Rule 10b-5
- Statistical anomaly detection in high-frequency financial time series

Always return strictly valid JSON — no markdown fences, no prose outside the object.`;

function mockTriage(alert: SuspiciousAlert): TriageResult {
  const highConfidence = alert.severity === 'CRITICAL' || alert.severity === 'HIGH';
  const verdict: TriageVerdict = highConfidence ? 'ESCALATE' : 'MONITOR';
  const confidence = highConfidence ? 85 + Math.floor(Math.random() * 10) : 55 + Math.floor(Math.random() * 10);

  const rationales: Record<string, string> = {
    LAYERING: `The order pattern exhibits hallmarks of layering: large visible orders inflate perceived demand before rapid cancellation enables a profitable counter-side fill. The ${(alert.metrics.cancellationRatio ?? 0.85 * 100).toFixed(0)}% cancellation rate well exceeds natural market-making thresholds.`,
    SPOOFING: `Rapid placement and cancellation of large directional orders consistent with spoofing intent. The ${alert.metrics.medianTimeToCancel ?? 340}ms median cancel time and subsequent opposite-direction fills confirm a deliberate price-distortion strategy.`,
    WASH_TRADING: `Near-perfect trade matching between suspected related accounts with a ${((alert.metrics.selfTradingRatio ?? 0.94) * 100).toFixed(0)}% self-trading ratio is statistically inconsistent with independent arm's-length trading, indicating artificial volume inflation.`,
    MOMENTUM_IGNITION: `Escalating order sequence successfully triggered algorithmic momentum before the trader reversed position. The pattern, while less certain than direct spoofing, carries meaningful manipulation risk at this anomaly score.`,
    FRONT_RUNNING: `Pre-positioning immediately before a large institutional order, combined with rapid liquidation at elevated prices, is highly indicative of illicit access to pre-trade information. The timing correlation is statistically improbable at chance.`,
  };

  const findingsByPattern: Record<string, string[]> = {
    LAYERING: [
      `Cancellation ratio ${((alert.metrics.cancellationRatio ?? 0.857) * 100).toFixed(1)}% vs 12% natural baseline`,
      `Median time-to-cancel ${alert.metrics.medianTimeToCancel ?? 620}ms — sub-1s is consistent with algorithmic spoofing`,
      `Anomaly score +${alert.metrics.anomalyScore ?? 4.2}σ against 30-day baseline`,
    ],
    SPOOFING: [
      `7 of 8 large SELL orders cancelled within ${alert.metrics.medianTimeToCancel ?? 340}ms`,
      `Price impact of ${alert.metrics.priceImpact ?? -0.58}% achieved before cancellation`,
      `Subsequent BUY fills at deflated price confirm directional intent`,
    ],
    WASH_TRADING: [
      `Self-trading ratio ${((alert.metrics.selfTradingRatio ?? 0.94) * 100).toFixed(0)}% across 12 matched trades`,
      `Volume multiple ${alert.metrics.volumeMultiple ?? 3.2}x normal session average`,
      `No genuine beneficial ownership transfer detected`,
    ],
    MOMENTUM_IGNITION: [
      `8 escalating BUY orders triggered +${alert.metrics.priceImpact ?? 0.13}% price movement`,
      `Volume multiple ${alert.metrics.volumeMultiple ?? 2.1}x preceding session average`,
      `Large position liquidated at peak, consistent with pump-and-dump intent`,
    ],
    FRONT_RUNNING: [
      `Pre-positioning completed 32 seconds before 500,000-share institutional order`,
      `Price impact +${alert.metrics.priceImpact ?? 1.5}% following institutional fill`,
      `Timing correlation p-value < 0.001 — statistically improbable at chance`,
    ],
  };

  const risksByPattern: Record<string, string[]> = {
    LAYERING: ['SEBI Circular SEBI/HO/MRD/2022/111 violation', 'Algorithmic trading licence review required'],
    SPOOFING: ['Market abuse regulation breach', 'Pattern repeats over 3-session lookback'],
    WASH_TRADING: ['Potential tax evasion via artificial P&L', 'Beneficial ownership disclosure violation'],
    MOMENTUM_IGNITION: ['Repeat pattern detected across 2 prior sessions', 'Possible coordination with external parties'],
    FRONT_RUNNING: ['Information barrier breach', 'Potential criminal liability under SEBI Act s.12A'],
  };

  return {
    verdict,
    confidence,
    rationale: rationales[alert.patternType] ?? 'Pattern analysis indicates elevated manipulation risk.',
    keyFindings: findingsByPattern[alert.patternType] ?? [],
    riskFactors: risksByPattern[alert.patternType] ?? [],
    triageTimestamp: new Date().toISOString(),
  };
}

export async function POST(request: NextRequest) {
  try {
    const alert: SuspiciousAlert = await request.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      await new Promise(r => setTimeout(r, 800)); // simulate latency
      return NextResponse.json(mockTriage(alert));
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const pct = (v?: number) => (v !== undefined ? `${(v * 100).toFixed(1)}%` : 'N/A');
    const num = (v?: number, suffix = '') => (v !== undefined ? `${v}${suffix}` : 'N/A');

    const userPrompt = `Analyse this trade surveillance alert and provide your triage assessment.

ALERT ID: ${alert.alertId}
PATTERN TYPE: ${alert.patternType}
TRADER: ${alert.traderId}
INSTRUMENT: ${alert.instrument} (${alert.exchange})
SEVERITY: ${alert.severity}
DETECTED: ${alert.detectedAt}
TOTAL ORDERS: ${alert.orderCount}

DESCRIPTION:
${alert.description}

QUANTITATIVE METRICS:
- Cancellation Ratio: ${pct(alert.metrics.cancellationRatio)}
- Median Time-to-Cancel: ${num(alert.metrics.medianTimeToCancel, 'ms')}
- Anomaly Score vs 30-day Baseline: ${num(alert.metrics.anomalyScore, 'σ')}
- Volume Multiple: ${num(alert.metrics.volumeMultiple, 'x normal')}
- Price Impact: ${num(alert.metrics.priceImpact, '%')}
- Self-Trading Ratio: ${pct(alert.metrics.selfTradingRatio)}

Respond with ONLY a JSON object in this exact schema (no markdown, no extra prose):
{
  "verdict": "ESCALATE" | "MONITOR" | "FALSE_POSITIVE",
  "confidence": <integer 0-100>,
  "rationale": "<2-3 sentence evidence-based assessment>",
  "keyFindings": ["<quantitative finding 1>", "<finding 2>", "<finding 3>"],
  "riskFactors": ["<regulatory/legal risk 1>", "<risk 2>"]
}

Decision thresholds:
- ESCALATE: clear manipulation evidence, immediate regulatory risk, confidence > 65%
- MONITOR: suspicious but inconclusive, confidence 35-65%
- FALSE_POSITIVE: likely legitimate, confidence < 35%`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = message.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type');

    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not extract JSON from response');

    const parsed = JSON.parse(jsonMatch[0]);

    const result: TriageResult = {
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      keyFindings: parsed.keyFindings ?? [],
      riskFactors: parsed.riskFactors ?? [],
      triageTimestamp: new Date().toISOString(),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('Triage error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Triage failed' },
      { status: 500 },
    );
  }
}
