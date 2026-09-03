import { ArrowCounterClockwise, Check, Copy, Robot, Trash, User } from '@phosphor-icons/react';
import { useState } from 'react';
import { useStore, type Severity } from '../store';
import { Pane } from './Pane';

/** Same discipline as the service rail: one hue, weight carries severity. */
function SeverityMark({ severity }: { severity: Severity }) {
  if (severity === 'critical') return <span className="mt-1 h-2 w-2 shrink-0 bg-alert" aria-hidden />;
  if (severity === 'warning') return <span className="mt-1 h-2 w-2 shrink-0 border border-alert" aria-hidden />;
  return <span className="mt-1 h-2 w-2 shrink-0 border border-line-strong" aria-hidden />;
}

const JUDGE_PROMPT = 'Checkout p99 is spiking. Investigate the root cause, pin each evidence-backed finding, propose the safest mitigation for my approval, and draft the incident report.';

const SOURCE_TARGETS: Record<string, { label: string; id: string }> = {
  get_service_health: { label: 'service health', id: 'service-rail' },
  query_metrics: { label: 'metrics', id: 'pane-chart' },
  filter_traces: { label: 'traces', id: 'pane-traces' },
  search_logs: { label: 'logs', id: 'pane-logs' },
  correlate_with_deploys: { label: 'deploy correlation', id: 'pane-chart' },
};

export function IncidentTimeline() {
  const [copied, setCopied] = useState(false);
  const mcp = useStore((state) => state.mcp);
  const findings = useStore((s) => s.findings);
  const removeFinding = useStore((s) => s.removeFinding);
  const resetIncident = useStore((s) => s.resetIncident);
  const sorted = [...findings].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  // The banner under the header already carries the no-host diagnosis; saying
  // it again here is two notices for one condition.
  const toolLine =
    mcp.state === 'connected'
      ? `WebMCP · ${mcp.toolCount} registered tools · shared live state`
      : 'Nine tools are defined and ready for a host · every one is also a control on this page';

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(JUDGE_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const jumpToSource = (source: string) => {
    const target = SOURCE_TARGETS[source];
    if (!target) return;
    document.getElementById(target.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <Pane
      id="timeline"
      title={sorted.length ? 'Agent findings' : 'Agent investigation'}
      className="decision-timeline shrink-0 border-b border-line"
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
            <p>Give your agent one prompt. Its evidence, tool trail, and action request will appear here while you stay in control.</p>
            <div className="judge-actions">
              <button type="button" className="copy-investigation-prompt" onClick={copyPrompt}>
                {copied ? <Check size={15} weight="bold" /> : <Copy size={15} />}
                {copied ? 'Prompt copied' : 'Copy investigation prompt'}
              </button>
              <button type="button" className="reset-demo" onClick={() => resetIncident()}>
                <ArrowCounterClockwise size={15} />
                Reset demo
              </button>
            </div>
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
                    {/* The one destructive control in the findings list, so it
                        reads as a control rather than as a word, and it stays
                        reachable by keyboard whether or not the row is hovered. */}
                    <button
                      type="button"
                      onClick={() => removeFinding(f.id)}
                      aria-label={`Remove finding: ${f.title}`}
                      title="Remove this finding"
                      className="finding-remove"
                    >
                      <Trash size={14} />
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
                    {f.confidence !== undefined && <span>· {Math.round(f.confidence * 100)}% confidence</span>}
                  </p>
                  {!!f.sourceRefs?.length && (
                    <div className="finding-sources" aria-label="Finding evidence sources">
                      {f.sourceRefs.map((source) => (
                        <button key={source} type="button" onClick={() => jumpToSource(source)}>
                          {SOURCE_TARGETS[source]?.label ?? source}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Pane>
  );
}
