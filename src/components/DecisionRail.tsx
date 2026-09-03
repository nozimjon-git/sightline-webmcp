import { Info, ShieldCheck } from '@phosphor-icons/react';
import { ALERTS, SERVICES, clock } from '../data/incident';
import { incidentMeta, resolvedAlertIds, useStore } from '../store';
import { ReportCard } from './ReportCard';
import { RollbackCard } from './RollbackCard';

function IncidentSummary() {
  const resolved = useStore(resolvedAlertIds);
  const findings = useStore((state) => state.findings);
  const applied = useStore((state) => state.appliedRollback);
  const activeAlerts = ALERTS.filter((alert) => !alert.resolvedAt && !resolved.includes(alert.id));
  const affectedServices = new Set(activeAlerts.map((alert) => alert.service)).size;

  return (
    <section className="rail-section incident-summary" aria-labelledby="incident-summary-title">
      <header className="rail-section-header">
        <h2 id="incident-summary-title">Incident summary</h2>
        <Info size={15} />
      </header>
      <dl className="summary-grid">
        <dt>Severity</dt>
        <dd className="text-alert">SEV-2 · customer impact</dd>
        <dt>Status</dt>
        <dd>{applied?.decision === 'approved' ? 'Mitigated' : 'Active'}</dd>
        <dt>Opened</dt>
        <dd>{clock(incidentMeta.declaredAt)} UTC</dd>
        <dt>Commander</dt>
        <dd>{incidentMeta.commander}</dd>
        <dt>Services affected</dt>
        <dd>{affectedServices} of {SERVICES.length}</dd>
        <dt>Active alerts</dt>
        <dd>{activeAlerts.length}</dd>
        <dt>Pinned findings</dt>
        <dd>{findings.length}</dd>
      </dl>
    </section>
  );
}

export function DecisionRail() {
  const pending = useStore((state) => state.pendingRollback);
  const applied = useStore((state) => state.appliedRollback);
  const decisionLabel = pending ? 'Decision required' : applied ? 'Decision recorded' : 'Mitigation';

  return (
    <aside className="decision-rail" aria-label="Incident decision and report">
      <div className="decision-rail-title">
        <span>{decisionLabel}</span>
        <span className="decision-safety"><ShieldCheck size={15} /> Human controlled</span>
      </div>
      <RollbackCard />
      <IncidentSummary />
      <ReportCard />
    </aside>
  );
}
