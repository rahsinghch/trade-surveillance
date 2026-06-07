import { NextRequest, NextResponse } from 'next/server';
import { SuspiciousAlert, TriageResult, EscalationAction, ActionType } from '@/lib/types';

let actionSeq = 8800;
const nextActionId = () => `ACT-${String(++actionSeq).padStart(5, '0')}`;
const rndInt = (min: number, max: number) => Math.floor(Math.random() * (max - min) + min);

function makeAction(
  alertId: string,
  actionType: ActionType,
  description: string,
  result: string,
): EscalationAction {
  return {
    actionId: nextActionId(),
    alertId,
    actionType,
    status: 'TRIGGERED',
    description,
    result,
    timestamp: new Date().toISOString(),
  };
}

export async function POST(request: NextRequest) {
  try {
    const { alert, triage }: { alert: SuspiciousAlert; triage: TriageResult } =
      await request.json();

    const actions: EscalationAction[] = [];
    const { alertId, traderId, instrument, patternType, severity } = alert;
    const { verdict, confidence } = triage;

    if (verdict === 'ESCALATE') {
      const jiraId = `COMP-${rndInt(8800, 9500)}`;

      actions.push(
        makeAction(
          alertId,
          'JIRA_CASE',
          `Compliance case created for ${patternType}`,
          `${jiraId} created and assigned to Surveillance Desk L2 — ${patternType} / ${instrument}`,
        ),
      );

      actions.push(
        makeAction(
          alertId,
          'SLACK_NOTIFICATION',
          'Alert digest sent to #compliance-alerts',
          `Posted: "🚨 ${alertId} | ${patternType} | ${instrument} | ${confidence}% confidence | Trader: ${traderId}"`,
        ),
      );

      if (severity === 'HIGH' || severity === 'CRITICAL') {
        actions.push(
          makeAction(
            alertId,
            'WATCHLIST_FLAG',
            'Trader flagged for enhanced monitoring',
            `Trader ${traderId} added to surveillance watchlist — 72-hour enhanced monitoring active`,
          ),
        );
      }

      if (severity === 'CRITICAL') {
        actions.push(
          makeAction(
            alertId,
            'EMAIL_ALERT',
            'Critical alert email dispatched',
            `Email sent to compliance-head@firm.com and rahul.singh2@wissen.com and Meghana.Raveendra@wissen.com and nitish.jain@wissen.com re: ${alertId}`,
          ),
        );
      }
    } else if (verdict === 'MONITOR') {
      actions.push(
        makeAction(
          alertId,
          'SLACK_NOTIFICATION',
          'Alert queued in #surveillance-watch',
          `Posted: "⚠️ ${alertId} | MONITOR | ${patternType} | ${instrument} | ${confidence}% confidence"`,
        ),
      );

      actions.push(
        makeAction(
          alertId,
          'WATCHLIST_FLAG',
          'Trader added to soft monitoring queue',
          `Trader ${traderId} added to 7-day soft monitoring list`,
        ),
      );
    }

    return NextResponse.json({ actions });
  } catch (err) {
    console.error('Escalation error:', err);
    return NextResponse.json({ error: 'Escalation failed' }, { status: 500 });
  }
}
