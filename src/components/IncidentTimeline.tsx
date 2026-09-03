import { useStore, type Severity } from '../store';
import { Empty, Pane } from './Pane';

/** Same discipline as the service rail: one hue, weight carries severity. */
function SeverityMark({ severity }: { severity: Severity }) {
  if (severity === 'critical') return <span className="mt-1 h-2 w-2 shrink-0 bg-alert" aria-hidden />;
  if (severity === 'warning') return <span className="mt-1 h-2 w-2 shrink-0 border border-alert" aria-hidden />;
  return <span className="mt-1 h-2 w-2 shrink-0 border border-line-strong" aria-hidden />;
}

export function IncidentTimeline() {
  const findings = useStore((s) => s.findings);
  const removeFinding = useStore((s) => s.removeFinding);
  const sorted = [...findings].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return (
    <Pane
      id="timeline"
      title="Incident timeline"
      className="decision-timeline min-h-0 flex-1 border-b border-line"
      bodyClassName="overflow-y-auto"
      controls={
        findings.length > 0 ? (
          <span className="shrink-0 font-mono text-2xs tnum whitespace-nowrap text-ink-faint">
            {findings.length} pinned · {findings.filter((f) => f.pinnedBy === 'agent').length} by agent
          </span>
        ) : undefined
      }
    >
      {sorted.length === 0 ? (
        <Empty>No findings pinned yet. Ask your agent to investigate.</Empty>
      ) : (
        <ol>
          {sorted.map((f) => (
            <li key={f.id} className="group border-b border-line px-3 py-2">
              <div className="flex gap-2">
                <SeverityMark severity={f.severity} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xs tnum text-ink-faint">{f.timestamp}</span>
                    <span className="min-w-0 flex-1 text-xs leading-snug text-ink">{f.title}</span>
                    <button
                      type="button"
                      onClick={() => removeFinding(f.id)}
                      aria-label={`Remove finding: ${f.title}`}
                      className="control-hit shrink-0 px-1 text-2xs text-ink-faint opacity-40 group-hover:opacity-100 focus:opacity-100 hover:text-alert"
                    >
                      remove
                    </button>
                  </div>
                  <p className="mt-1 text-2xs leading-relaxed text-ink-dim">{f.evidence}</p>
                  <p className="mt-1 font-mono text-2xs text-ink-faint">
                    <span className={f.pinnedBy === 'agent' ? 'text-agent' : 'text-ink-dim'}>
                      {f.pinnedBy === 'agent' ? 'agent' : 'you'}
                    </span>
                    {' · '}
                    {f.severity}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Pane>
  );
}
