/**
 * Manual path versus agent-assisted path, on this same incident.
 *
 * The agent column is measured from the activity trail as the investigation
 * happens. The manual column is an estimate written down in the fixture. Those
 * are different kinds of number, so the panel says which is which rather than
 * printing them in one row and letting the reader assume both were observed.
 */

import { MANUAL_BASELINE } from '../data/incident';
import { impactBreadth } from '../lib/analysis';
import { useStore } from '../store';

const minutesBetween = (from: number, to: number) => Math.max(1, Math.round((to - from) / 60_000));

export function ImpactPanel() {
  const activity = useStore((state) => state.activity);
  const findings = useStore((state) => state.findings);
  const applied = useStore((state) => state.appliedRollback);
  const timeWindow = useStore((state) => state.window);
  const breadth = impactBreadth(timeWindow);

  const agentCalls = activity.filter((entry) => entry.actor === 'agent' && entry.ok);
  // A sweep only rules anything out once it has actually run. Before that the
  // breadth figures describe the fixture, not the investigation.
  const swept = agentCalls.some((entry) => entry.label === 'get_service_health');
  const correlated = agentCalls.some((entry) => entry.label === 'correlate_with_deploys');
  const started = agentCalls.length ? Math.min(...agentCalls.map((entry) => entry.at)) : null;
  const rootCause = findings
    .filter((f) => f.severity === 'critical')
    .map((f) => Date.parse(f.pinnedAt))
    .sort((a, b) => a - b)[0];

  const toRootCause = started && rootCause ? `${minutesBetween(started, rootCause)} min` : '—';
  // decidedAt is incident time (15:03, deterministic), so elapsed wall-clock
  // comes from the activity entry the approval wrote.
  const approvedAt = activity.find((entry) => entry.label === 'APPROVED rollback')?.at;
  const toMitigation =
    started && applied?.decision === 'approved' && approvedAt
      ? `${minutesBetween(started, approvedAt)} min`
      : '—';

  const rows = [
    { label: 'Time to root cause', manual: `~${MANUAL_BASELINE.minutesToRootCause} min`, agent: toRootCause },
    { label: 'Time to mitigation', manual: `~${MANUAL_BASELINE.minutesToMitigation} min`, agent: toMitigation },
    {
      label: 'Queries run',
      manual: `~${MANUAL_BASELINE.consoleQueries}`,
      agent: agentCalls.length ? String(agentCalls.length) : '—',
    },
    {
      label: 'Leads ruled out',
      manual: 'one at a time',
      agent:
        swept || correlated
          ? [
              swept ? `${breadth.servicesScanned - 1} services` : null,
              correlated ? `${Math.max(0, breadth.deploysConsidered - 1)} deploys` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : '—',
    },
  ];

  return (
    <section className="rail-section impact-panel" aria-labelledby="impact-title">
      <header className="rail-section-header">
        <h2 id="impact-title">Manual vs agent-assisted</h2>
      </header>

      <table className="impact-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col">Manual</th>
            <th scope="col" className="is-agent">Agent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.manual}</td>
              <td className="is-agent">{row.agent}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="impact-note">
        Agent figures are measured from this session's activity trail. Manual figures are an estimate
        for working this incident by hand, recorded in the fixture.
      </p>
    </section>
  );
}
