/**
 * WebMCP status, where it can actually be read.
 *
 * This used to live at the foot of the activity band, which is the wrong place
 * twice over: on a narrow screen the band sits below the whole investigation,
 * and the band is sized for a four-line ticker, so the recovery path — the
 * facts and the retry button — was clipped off entirely.
 *
 * It is a mode, not an error: without a host every tool still works by hand. So
 * the collapsed bar states that in one line and the diagnosis is one click
 * away, rather than a permanent block of red at the top of the console.
 */

import { ArrowsClockwise, CaretDown, Check, Copy, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { useStore } from '../store';

const FLAG_URL = 'chrome://flags/#enable-webmcp-testing';

export function HostBanner() {
  const mcp = useStore((state) => state.mcp);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (mcp.state === 'connected' || mcp.state === 'checking') return null;

  const rejected = mcp.state === 'error';
  const originKeyed = (globalThis as { originAgentCluster?: boolean }).originAgentCluster;

  const copyFlag = async () => {
    try {
      await navigator.clipboard.writeText(FLAG_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="host-banner" role="status">
      <div className="host-banner-bar">
        <WarningCircle size={16} weight="fill" aria-hidden />
        <p>
          <strong>{rejected ? 'WebMCP host rejected registration' : 'No WebMCP host detected'}</strong>
          <span>Every tool still works by hand — nothing here is gated on the agent.</span>
        </p>
        <button
          type="button"
          className={`host-banner-toggle ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="host-banner-details"
        >
          <CaretDown size={13} weight="bold" aria-hidden />
          {open ? 'Hide details' : 'Why?'}
        </button>
        <button
          type="button"
          className="host-banner-retry"
          onClick={() => window.dispatchEvent(new Event('sightline:retry-mcp'))}
        >
          <ArrowsClockwise size={14} aria-hidden /> Retry
        </button>
      </div>

      {open && (
        <dl className="host-facts" id="host-banner-details">
          {/* A registration error carries the host's own message, which is the
              one thing worth reading verbatim. The no-host case does not: its
              message only restates the two facts below it. */}
          {rejected && mcp.message && (
            <>
              <dt>Error</dt>
              <dd className="host-fact-error">{mcp.message}</dd>
            </>
          )}
          <dt>Probed</dt>
          <dd>{mcp.api && mcp.api !== 'none' ? mcp.api : 'document.modelContext, navigator.modelContext'}</dd>
          <dt>Origin-keyed</dt>
          <dd>{originKeyed === undefined ? 'unknown' : originKeyed ? 'yes' : 'no — needs Origin-Agent-Cluster: ?1'}</dd>
          <dt>Enable</dt>
          <dd>
            Open in ChatGPT, or Chrome 149+ with
            {/* chrome:// cannot be linked, so the next best thing is to hand
                over the string ready to paste. */}
            <button type="button" className="flag-copy" onClick={copyFlag} title={`Copy ${FLAG_URL}`}>
              {copied ? <Check size={12} weight="bold" aria-hidden /> : <Copy size={12} aria-hidden />}
              {copied ? 'copied' : FLAG_URL}
            </button>
          </dd>
        </dl>
      )}
    </aside>
  );
}
