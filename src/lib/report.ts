/**
 * Postmortem assembly.
 *
 * The report is *derived*, not written. Its prose comes from two places: the
 * findings a human or an agent pinned (quoted verbatim, attributed), and
 * numbers recomputed here from the series. Nothing in it is a template
 * sentence dressed up as an observation — if the agent pinned nothing, there
 * is nothing to assemble and `draft_incident_report` says so.
 */

import {
  ALERTS,
  DEPLOYS,
  INCIDENT,
  SERIES,
  SERVICES,
  clock,
  minuteOfIso,
  type ServiceId,
} from '../data/incident';
import { serviceHealth } from './analysis';
import type { AppliedRollback, Finding, IncidentReport, ReportSection } from '../store';

const LATENCY_SLO_MS = 1000;

export interface ReportContext {
  nowIso: string;
  resolvedAlertIds: string[];
  appliedRollback: AppliedRollback | null;
}

interface Impact {
  service: ServiceId;
  minutesOverSlo: number;
  peakP99: number;
  peakErrorRate: number;
  failedRequests: number;
}

function computeImpact(nowIso: string): Impact | null {
  const end = minuteOfIso(nowIso);
  let worst: Impact | null = null;

  for (const svc of SERVICES) {
    const p99 = SERIES[svc.id].p99.slice(0, end + 1);
    const errors = SERIES[svc.id].error_rate.slice(0, end + 1);
    const overSlo = p99.filter((p) => p.v > LATENCY_SLO_MS).length;
    if (overSlo === 0) continue;

    // Failed requests = sum over minutes of (error rate x steady-state rpm),
    // counting only the minutes the service was over its latency SLO.
    const failed = errors.reduce(
      (acc, e, i) => (p99[i].v > LATENCY_SLO_MS ? acc + (e.v / 100) * svc.rpm : acc),
      0,
    );
    const impact: Impact = {
      service: svc.id,
      minutesOverSlo: overSlo,
      peakP99: Math.max(...p99.map((p) => p.v)),
      peakErrorRate: Math.max(...errors.map((e) => e.v)),
      failedRequests: Math.round(failed),
    };
    if (!worst || impact.minutesOverSlo > worst.minutesOverSlo) worst = impact;
  }
  return worst;
}

const attribution = (f: Finding) => (f.pinnedBy === 'agent' ? 'agent' : 'on-call');

export function buildReport(findings: Finding[], ctx: ReportContext): IncidentReport {
  const health = serviceHealth(ctx.nowIso, ctx.resolvedAlertIds);
  const impact = computeImpact(ctx.nowIso);
  // The earliest alert of the day belongs to the inventory red herring, so the
  // summary reports the first *critical* alert when there is one.
  const firedAlerts = [...ALERTS].filter((a) => a.firedAt <= ctx.nowIso).sort((a, b) => a.firedAt.localeCompare(b.firedAt));
  const firstAlert = firedAlerts.find((a) => a.severity === 'critical') ?? firedAlerts[0];
  const stillDegraded = health.filter((h) => h.status !== 'healthy');

  const sections: ReportSection[] = [];

  // --- Summary -------------------------------------------------------------
  const critical = findings.filter((f) => f.severity === 'critical');
  sections.push({
    heading: 'Summary',
    body: [
      `${INCIDENT.id} — ${INCIDENT.title}. First alert ${firstAlert ? `${firstAlert.name} at ${clock(firstAlert.firedAt)}` : 'not recorded'}; report generated at ${clock(ctx.nowIso)}.`,
      impact
        ? `${impact.service} spent ${impact.minutesOverSlo} minutes above the ${LATENCY_SLO_MS}ms p99 SLO, peaking at ${impact.peakP99}ms with a ${impact.peakErrorRate}% error rate.`
        : 'No service exceeded its latency SLO in the window analysed.',
      stillDegraded.length
        ? `Currently unhealthy: ${stillDegraded.map((h) => `${h.service} (${h.status})`).join(', ')}.`
        : 'All services are currently healthy.',
    ],
  });

  // --- Impact --------------------------------------------------------------
  if (impact) {
    const svc = SERVICES.find((s) => s.id === impact.service);
    sections.push({
      heading: 'Impact',
      body: [
        `Approximately ${impact.failedRequests.toLocaleString('en-US')} failed requests, from ${svc?.rpm.toLocaleString('en-US')} req/min steady-state traffic across ${impact.minutesOverSlo} degraded minutes.`,
        `Owning team: ${svc?.owner ?? 'unknown'}. Tier ${svc?.tier ?? '?'} service.`,
        `Downstream services affected: ${health.filter((h) => h.status !== 'healthy' && h.service !== impact.service).map((h) => h.service).join(', ') || 'none'}.`,
      ],
    });
  }

  // --- Timeline ------------------------------------------------------------
  type Row = { t: string; text: string };
  const rows: Row[] = [
    ...DEPLOYS.filter((d) => d.at <= ctx.nowIso).map((d) => ({
      t: clock(d.at),
      text: `Deploy ${d.id} — ${d.service} ${d.version} (${d.author})`,
    })),
    ...ALERTS.filter((a) => a.firedAt <= ctx.nowIso).map((a) => ({
      t: clock(a.firedAt),
      text: `Alert fired — ${a.name} on ${a.service} [${a.severity}]`,
    })),
    ...findings.map((f) => ({ t: f.timestamp, text: `Finding (${attribution(f)}) — ${f.title}` })),
  ].sort((a, b) => a.t.localeCompare(b.t));

  sections.push({ heading: 'Timeline', body: rows.map((r) => `${r.t}  ${r.text}`) });

  // --- Findings ------------------------------------------------------------
  sections.push({
    heading: `Findings (${findings.length} pinned)`,
    body: findings.map((f) => `[${f.severity}] ${f.timestamp} — ${f.title}\n    Evidence: ${f.evidence}\n    Pinned by: ${attribution(f)}`),
  });

  // --- Root cause ----------------------------------------------------------
  const rootCauseBody: string[] = [];
  if (critical.length) {
    rootCauseBody.push('Stated by the investigation, from the critical findings pinned above:');
    for (const f of critical) rootCauseBody.push(`• ${f.title} — ${f.evidence}`);
  } else {
    rootCauseBody.push(
      'No finding was pinned at critical severity, so no root cause is asserted here. ' +
        'Pin the causal finding with severity "critical" and regenerate to fill this section.',
    );
  }
  const rolled = ctx.appliedRollback;
  if (rolled) {
    const deploy = DEPLOYS.find((d) => d.id === rolled.deployId);
    rootCauseBody.push(
      rolled.decision === 'approved'
        ? `Mitigation: ${rolled.deployId} (${deploy?.service} ${deploy?.version}) was rolled back after human approval. Reason given: "${rolled.reason}"`
        : `A rollback of ${rolled.deployId} was proposed and dismissed by the on-call engineer.`,
    );
  }
  sections.push({ heading: 'Root cause', body: rootCauseBody });

  // --- Follow-ups ----------------------------------------------------------
  const followUps: string[] = [];
  if (rolled?.decision === 'approved') {
    followUps.push(`Confirm ${rolled.service} stays healthy for 30 minutes post-rollback, then close ${INCIDENT.id}.`);
    followUps.push(`Re-land the reverted change with the configuration defect fixed before redeploying ${rolled.version}.`);
  } else {
    followUps.push('No mitigation has been applied. Decide on the proposed rollback or escalate.');
  }
  if (stillDegraded.length) {
    followUps.push(`Clear remaining alerts: ${stillDegraded.flatMap((h) => h.alert_names).join(', ') || 'none named'}.`);
  }
  followUps.push('Add a deploy-time guard that fails the build when a production pool size drops by more than 50%.');
  sections.push({ heading: 'Follow-ups', body: followUps });

  return {
    incidentId: INCIDENT.id,
    title: INCIDENT.title,
    generatedAt: new Date().toISOString(),
    sections,
    findingCount: findings.length,
  };
}
