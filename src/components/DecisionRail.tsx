import { ArrowRight, Info, ShieldCheck, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { ALERTS, SERVICES, clock } from '../data/incident';
import { incidentMeta, resolvedAlertIds, useStore } from '../store';
import { ImpactPanel } from './ImpactPanel';
import { ReportCard } from './ReportCard';
import { ApprovalFooter, RollbackCard } from './RollbackCard';

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pending = useStore((state) => state.pendingRollback);
  const applied = useStore((state) => state.appliedRollback);
  const decisionLabel = pending ? 'Decision required' : applied ? 'Decision recorded' : 'Mitigation';

  useEffect(() => {
    if (pending) setDrawerOpen(true);
  }, [pending]);

  return (
    <>
      <button
        type="button"
        className={`mobile-decision-trigger ${pending ? 'has-decision' : ''}`}
        onClick={() => setDrawerOpen(true)}
        aria-expanded={drawerOpen}
        aria-controls="decision-rail"
      >
        <ShieldCheck size={17} weight="fill" />
        <span>{decisionLabel}</span>
        <ArrowRight size={16} />
      </button>
      {drawerOpen && <button type="button" className="decision-drawer-scrim" aria-label="Close decision panel" onClick={() => setDrawerOpen(false)} />}
      <aside id="decision-rail" className={`decision-rail ${drawerOpen ? 'is-mobile-open' : ''}`} aria-label="Incident decision and report">
        <div className="decision-rail-title">
          <span>{decisionLabel}</span>
          <span className="decision-safety"><ShieldCheck size={15} /> Human controlled</span>
          <button type="button" className="decision-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close decision panel"><X size={17} /></button>
        </div>
        <div className="decision-rail-scroll">
          <RollbackCard />
          <IncidentSummary />
          <ImpactPanel />
          <ReportCard />
        </div>
        <ApprovalFooter />
      </aside>
    </>
  );
}
