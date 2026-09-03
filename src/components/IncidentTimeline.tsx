import { Robot, User } from '@phosphor-icons/react';
import { useStore, type Severity } from '../store';
import { Pane } from './Pane';

/** Same discipline as the service rail: one hue, weight carries severity. */
function SeverityMark({ severity }: { severity: Severity }) {
  if (severity === 'critical') return <span className="mt-1 h-2 w-2 shrink-0 bg-alert" aria-hidden />;
  if (severity === 'warning') return <span className="mt-1 h-2 w-2 shrink-0 border border-alert" aria-hidden />;
  return <span className="mt-1 h-2 w-2 shrink-0 border border-line-strong" aria-hidden />;
}

export function IncidentTimeline() {
  const mcp = useStore((state) => state.mcp);
  const findings = useStore((s) => s.findings);
  const removeFinding = useStore((s) => s.removeFinding);
  const sorted = [...findings].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const toolLine =
    mcp.state === 'connected'
      ? `WebMCP · ${mcp.toolCount} registered tools · shared live state`
      : 'No WebMCP host detected · this console is fully usable by hand';

  return (
    <Pane
      id="timeline"
      title={sorted.length ? 'Agent findings' : 'Agent investigation'}
      className={`decision-timeline min-h-0 border-b border-line ${sorted.length ? 'min-h-[9rem] flex-1' : 'shrink-0'}`}
      bodyClassName="overflow-y-auto"
      controls={
        findings.length > 0 ? (
          <span className="shrink-0 font-mono text-2xs tnum whitespace-nowrap text-ink-faint">
            {findings.length} pinned
          </span>
        ) : undefined
      }
    >
      {sorted.length === 0 ? (
        <div className="agent-empty-state">
          <Robot size={20} weight="fill" aria-hidden />
          <div>
            <strong>Ready to investigate this incident</strong>
            <p>Ask your agent to trace the p99 spike. Whatever it pins lands here, stamped with who pinned it and when.</p>
            <span>{toolLine}</span>
          </div>
        </div>
      ) : (
        <ol>
          {sorted.map((f) => (
            <li key={f.id} className="finding-row group border-b border-line px-3 py-2">
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
                  <p className="finding-provenance mt-1 font-mono text-2xs text-ink-faint">
                    {f.pinnedBy === 'agent' ? (
                      <Robot size={13} weight="fill" className="text-agent" aria-hidden />
                    ) : (
                      <User size={13} weight="fill" aria-hidden />
                    )}
                    <span className={f.pinnedBy === 'agent' ? 'text-agent' : 'text-ink-dim'}>
                      {f.pinnedBy === 'agent' ? 'pinned by the agent' : 'pinned by you'}
                    </span>
                    <span>· {f.severity}</span>
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
