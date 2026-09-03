import { clock } from '../data/incident';
import { incidentMeta, nowIso, useStore } from '../store';
import { useTouchFlash } from './Pane';

function McpBadge() {
  const mcp = useStore((s) => s.mcp);
  const tone =
    mcp.state === 'connected' ? 'text-agent' : mcp.state === 'error' ? 'text-alert' : 'text-ink-faint';
  const label =
    mcp.state === 'connected'
      ? `${mcp.toolCount} tools · ${mcp.api}`
      : mcp.state === 'checking'
        ? 'looking for a host…'
        : 'no host — running human-only';
  return (
    <div className="flex items-center gap-2" title={mcp.message ?? mcp.api} role="status" aria-live="polite">
      <span className="text-2xs text-ink-faint">webmcp</span>
      <span
        className={`h-1.5 w-1.5 shrink-0 ${mcp.state === 'connected' ? 'bg-agent' : mcp.state === 'error' ? 'bg-alert' : 'bg-line-strong'}`}
        aria-hidden
      />
      <span className={`font-mono text-2xs ${tone}`}>{label}</span>
    </div>
  );
}

/** Flashes when the agent calls get_current_view. The handoff made visible. */
function HandoffChip() {
  const flash = useTouchFlash('handoff');
  const prov = useStore((s) => s.provenance.handoff);
  return (
    <div
      className={`relative flex items-center gap-2 border border-line px-2 py-1 ${flash.className}`}
      title="The agent reads your current selection through get_current_view"
    >
      <span className="text-2xs text-ink-faint">view handoff</span>
      <span className={`font-mono text-2xs tnum ${prov ? 'text-agent' : 'text-ink-faint'}`}>
        {prov ? new Date(prov.at).toLocaleTimeString('en-GB', { hour12: false }) : '—'}
      </span>
    </div>
  );
}

export function Header() {
  const selectedWindow = useStore((s) => s.window);
  const applied = useStore((s) => s.appliedRollback);
  const now = useStore(nowIso);
  const resetIncident = useStore((s) => s.resetIncident);
  const live = applied?.decision !== 'approved';

  return (
    <header className="app-header flex min-h-14 shrink-0 items-center gap-4 border-b border-line bg-pane px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`h-6 w-1 ${live ? 'bg-alert' : 'bg-agent'}`}
          aria-hidden
        />
        <div className="leading-tight">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs font-medium text-ink">{incidentMeta.id}</span>
            <span className="truncate text-sm text-ink">{incidentMeta.title}</span>
          </div>
          <div className="font-mono text-2xs text-ink-faint tnum">
            {live ? 'active' : 'mitigated'} · declared {clock(incidentMeta.declaredAt)} · commander {incidentMeta.commander}
          </div>
        </div>
      </div>

      <div className="min-w-3 flex-1" />

      <div className="hidden items-baseline gap-2 md:flex">
        <span className="text-2xs text-ink-faint">window</span>
        <span className="font-mono text-xs text-ink tnum">{selectedWindow.label}</span>
        <span className="text-2xs text-ink-faint">· now {clock(now)} UTC</span>
      </div>

      <HandoffChip />
      <McpBadge />
      <button
        type="button"
        onClick={() => {
          if (globalThis.confirm('Reset the incident replay and clear this tab’s saved investigation?')) resetIncident();
        }}
        className="control-hit shrink-0 border border-line px-2.5 font-mono text-2xs text-ink-dim hover:border-line-strong hover:text-ink"
      >
        reset replay
      </button>
    </header>
  );
}
