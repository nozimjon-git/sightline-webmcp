import { ArrowsClockwise, Check, Copy, DotsThree, LinkSimple, Pulse, ShareNetwork } from '@phosphor-icons/react';
import { useState } from 'react';
import { clock } from '../data/incident';
import { incidentMeta, nowIso, useStore } from '../store';
import { useTouchFlash } from './Pane';

function McpBadge() {
  const mcp = useStore((state) => state.mcp);
  const connected = mcp.state === 'connected';
  const label = connected
    ? `Connected · ${mcp.toolCount} tools`
    : mcp.state === 'checking'
      ? 'Connecting…'
      : 'Human-only mode';

  const retry = () => window.dispatchEvent(new Event('sightline:retry-mcp'));
  const content = (
    <>
      <span className={`mcp-dot ${connected ? 'is-connected' : ''}`} aria-hidden />
      <span>WebMCP</span>
      <span className="mcp-detail">{label}</span>
      {!connected && mcp.state !== 'checking' && <ArrowsClockwise size={13} aria-hidden />}
    </>
  );

  return connected || mcp.state === 'checking' ? (
    <div className="mcp-status" title={mcp.message ?? mcp.api} role="status" aria-live="polite">{content}</div>
  ) : (
    <button
      type="button"
      className="mcp-status mcp-retry"
      title={`${mcp.message ?? 'No WebMCP host detected.'} Activate WebMCP in the ChatGPT in-app browser or Chrome, then retry.`}
      onClick={retry}
      aria-label="Retry WebMCP connection"
    >
      {content}
    </button>
  );
}

function HandoffBadge() {
  const provenance = useStore((state) => state.provenance.handoff);
  const service = useStore((state) => state.selectedService);
  const metric = useStore((state) => state.metric);
  const window = useStore((state) => state.window);
  const flash = useTouchFlash('handoff');
  const performedAt = provenance
    ? new Date(provenance.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div
      className={`handoff-status ${provenance ? 'is-synced' : ''} ${flash.className}`}
      title={provenance
        ? `Agent read ${service} · ${metric} · ${window.label}. Performed at ${performedAt}.`
        : `Shared view ready: ${service} · ${metric} · ${window.label}`}
      role="status"
      aria-live="polite"
    >
      <LinkSimple size={14} weight={provenance ? 'bold' : 'regular'} aria-hidden />
      <span>{provenance ? `Agent synced ${metric}` : 'Shared view ready'}</span>
      {performedAt && <time>{performedAt}</time>}
    </div>
  );
}

export function Header() {
  const [copied, setCopied] = useState(false);
  const applied = useStore((state) => state.appliedRollback);
  const now = useStore(nowIso);
  const resetIncident = useStore((state) => state.resetIncident);
  const live = applied?.decision !== 'approved';

  const share = async () => {
    try {
      await navigator.clipboard.writeText(globalThis.location.href);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <header className="app-header">
      <a className="brand" href="#investigation" aria-label="Sightline incident workspace">
        <Pulse size={20} weight="bold" />
        <span>SIGHTLINE</span>
      </a>

      <nav className="incident-breadcrumb" aria-label="Incident breadcrumb">
        <span className="breadcrumb-parent">Incidents</span>
        <span className="breadcrumb-separator" aria-hidden>/</span>
        <span className="incident-id">{incidentMeta.id}</span>
        <h1>{incidentMeta.title}</h1>
      </nav>

      <div className="incident-status-block">
        <span className={`incident-status ${live ? 'is-live' : 'is-mitigated'}`}>
          <span aria-hidden />
          {live ? 'ACTIVE' : 'MITIGATED'}
        </span>
        <span className="declared-copy">
          Declared {clock(incidentMeta.declaredAt)} by {incidentMeta.commander} · now {clock(now)} UTC
        </span>
      </div>

      <div className="header-actions">
        <HandoffBadge />
        <McpBadge />
        <button type="button" className="header-action" onClick={share} aria-label="Copy incident link">
          {copied ? <Check size={16} weight="bold" /> : <ShareNetwork size={16} />}
          <span>{copied ? 'Copied' : 'Share'}</span>
        </button>
        <details className="incident-menu">
          <summary className="header-action" aria-label="Incident actions">
            <DotsThree size={20} weight="bold" />
          </summary>
          <div className="incident-menu-popover">
            <button
              type="button"
              onClick={() => {
                if (globalThis.confirm('Reset the incident replay and clear this tab’s saved investigation?')) resetIncident();
              }}
            >
              <Copy size={15} />
              Reset incident replay
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
