import {
  ChartLineUp,
  CheckCircle,
  ClockCounterClockwise,
  Funnel,
  RocketLaunch,
  Robot,
  TerminalWindow,
} from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { DEPLOYS, INCIDENT_DATE, clock } from '../data/incident';
import { detectAnomalyStart, matchLogs, matchTraces, pointsIn } from '../lib/analysis';
import { extraLogs, useStore } from '../store';
import { IncidentTimeline } from './IncidentTimeline';
import { LatencyChart } from './LatencyChart';
import { LogStream } from './LogStream';
import { TraceTable } from './TraceTable';

type EvidenceView = 'timeline' | 'metrics';

function TimelineEvent({
  time,
  icon,
  tone = 'neutral',
  children,
  className = '',
}: {
  time: string | null;
  icon: ReactNode;
  tone?: 'neutral' | 'agent' | 'alert';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`timeline-event timeline-event-${tone} ${className}`}>
      {time ? (
        <time className="timeline-time tnum" dateTime={`${INCIDENT_DATE}T${time}:00Z`}>
          {time}
        </time>
      ) : (
        <span className="timeline-time tnum is-empty" aria-hidden>
          ——
        </span>
      )}
      <span className="timeline-node" aria-hidden>
        {icon}
      </span>
      <div className="timeline-card">{children}</div>
    </div>
  );
}

function DeploymentEvent() {
  const deploy = DEPLOYS.find((item) => item.id === 'dep-1104')!;
  const marked = useStore((state) => state.markedDeployIds.includes(deploy.id));
  const markDeploys = useStore((state) => state.markDeploys);

  return (
    <article className="event-summary">
      <div className="event-summary-main">
        <div className="event-title-row">
          <h3>Deployment</h3>
          <span className="event-context">{deploy.version} deployed to production</span>
        </div>
        <p className="event-meta">
          {deploy.service} <span aria-hidden>·</span> {deploy.id} <span aria-hidden>·</span> by {deploy.author}
        </p>
      </div>
      <button
        type="button"
        className={`quiet-button ${marked ? 'is-active' : ''}`}
        onClick={() => markDeploys(marked ? [] : [deploy.id], 'human')}
        aria-pressed={marked}
      >
        {marked ? <CheckCircle size={16} weight="fill" /> : <ChartLineUp size={16} />}
        {marked ? 'Marked on chart' : 'Mark on chart'}
      </button>
    </article>
  );
}

export function InvestigationWorkspace() {
  const [view, setView] = useState<EvidenceView>('timeline');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const service = useStore((state) => state.selectedService);
  const metric = useStore((state) => state.metric);
  const timeWindow = useStore((state) => state.window);
  const minLatency = useStore((state) => state.traceMinLatencyMs);
  const logQuery = useStore((state) => state.logQuery);
  const logLevel = useStore((state) => state.logLevel);
  const extra = useStore(extraLogs);
  const findings = useStore((state) => state.findings);
  const applied = useStore((state) => state.appliedRollback);

  const deploy = DEPLOYS.find((item) => item.id === 'dep-1104')!;
  const deployInWindow = deploy.at >= timeWindow.startIso && deploy.at <= timeWindow.endIso;

  // Each stamp is read out of the evidence sitting next to it, so the rail
  // re-times itself whenever the window or a filter changes.
  const anomalyAt = detectAnomalyStart(pointsIn(service, metric, timeWindow));
  const traces = matchTraces(service, timeWindow, minLatency);
  const slowest = traces.reduce<(typeof traces)[number] | null>(
    (worst, trace) => (!worst || trace.durationMs > worst.durationMs ? trace : worst),
    null,
  );
  const logs = matchLogs(service, timeWindow, extra, logQuery, logLevel === 'all' ? undefined : logLevel);
  const newestLog = logs.at(-1);
  const appliedDeploy = applied ? DEPLOYS.find((item) => item.id === applied.deployId) : undefined;

  return (
    <section id="investigation" className="investigation-workspace" aria-label="Incident investigation evidence">
      <div className="workspace-toolbar">
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-button ${filtersOpen ? 'is-active' : ''}`}
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
          >
            <Funnel size={16} />
            Scope
          </button>
        </div>
        <div className="toolbar-group toolbar-view" role="group" aria-label="Evidence view">
          <span>View</span>
          <button
            type="button"
            className={`toolbar-button ${view === 'timeline' ? 'is-active' : ''}`}
            onClick={() => setView('timeline')}
            aria-pressed={view === 'timeline'}
          >
            Evidence
          </button>
          <button
            type="button"
            className={`toolbar-button ${view === 'metrics' ? 'is-active' : ''}`}
            onClick={() => setView('metrics')}
            aria-pressed={view === 'metrics'}
          >
            Metrics only
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="active-filter-bar" role="status">
          <Funnel size={14} />
          <span>Service:</span>
          <strong>{service}</strong>
          <span className="filter-separator">·</span>
          <span>Window:</span>
          <strong>{timeWindow.label} UTC</strong>
          <span className="filter-separator">·</span>
          <span>Traces:</span>
          <strong>{minLatency > 0 ? `>= ${minLatency}ms` : 'all'}</strong>
          <button type="button" onClick={() => setFiltersOpen(false)}>Close</button>
        </div>
      )}

      <div className="workspace-scroll">
        <div className="timeline-range">
          <span>Showing {timeWindow.label} UTC</span>
          <span>{new Date(INCIDENT_DATE).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })}</span>
        </div>

        <div className={`evidence-timeline ${view === 'metrics' ? 'metrics-focus' : ''}`}>
          <TimelineEvent
            time={anomalyAt ? clock(anomalyAt) : null}
            icon={<ChartLineUp size={16} weight="bold" />}
            tone={anomalyAt ? 'alert' : 'neutral'}
            className="metric-event"
          >
            <LatencyChart />
          </TimelineEvent>

          {view === 'timeline' && (
            <>
              {deployInWindow && (
                <TimelineEvent time={clock(deploy.at)} icon={<RocketLaunch size={16} weight="fill" />} tone="agent">
                  <DeploymentEvent />
                </TimelineEvent>
              )}

              <TimelineEvent
                time={findings[0]?.timestamp ?? null}
                icon={<Robot size={17} weight="fill" />}
                tone="agent"
                className="findings-event"
              >
                <IncidentTimeline />
              </TimelineEvent>

              <TimelineEvent
                time={slowest ? clock(slowest.t) : null}
                icon={<ClockCounterClockwise size={16} weight="bold" />}
                tone={slowest ? 'alert' : 'neutral'}
                className="trace-event"
              >
                <TraceTable />
              </TimelineEvent>

              <TimelineEvent
                time={newestLog ? clock(newestLog.t) : null}
                icon={<TerminalWindow size={16} weight="bold" />}
                tone="neutral"
                className="logs-event"
              >
                <LogStream />
              </TimelineEvent>

              {applied?.decision === 'approved' && appliedDeploy && (
                <TimelineEvent
                  time={clock(applied.decidedAt)}
                  icon={<CheckCircle size={17} weight="fill" />}
                  tone="agent"
                >
                  <article className="event-summary mitigation-event">
                    <div className="event-summary-main">
                      <div className="event-title-row">
                        <h3>Rollback applied</h3>
                        <span className="event-context">
                          {appliedDeploy.service} restored to {appliedDeploy.previousVersion}
                        </span>
                      </div>
                      <p className="event-meta">
                        Approved by you · post-rollback telemetry is now available to every tool
                      </p>
                    </div>
                  </article>
                </TimelineEvent>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
