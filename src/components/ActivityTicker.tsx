import { ArrowRight, ArrowsClockwise, Robot, User, WarningCircle } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { clock } from '../data/incident';
import { nowIso, useStore } from '../store';

/**
 * What to do when there is no host.
 *
 * "No agent host" tells someone nothing they can act on. This says which
 * surfaces were probed, whether the document is origin-keyed (the usual
 * cause), how to turn WebMCP on, and offers a retry — the app stays fully
 * usable by hand either way.
 */
function HostDiagnostic() {
  const mcp = useStore((state) => state.mcp);
  const originKeyed = (globalThis as { originAgentCluster?: boolean }).originAgentCluster;

  return (
    <div className="host-diagnostic" role="status">
      <WarningCircle size={17} weight="fill" aria-hidden />
      <div>
        <strong>{mcp.state === 'error' ? 'WebMCP host rejected registration' : 'No WebMCP host detected'}</strong>
        <p>{mcp.message ?? 'Neither document.modelContext nor navigator.modelContext is present.'}</p>
        <dl className="host-facts">
          <dt>Surface probed</dt>
          <dd>{mcp.api && mcp.api !== 'none' ? mcp.api : 'document.modelContext, navigator.modelContext'}</dd>
          <dt>Origin-keyed</dt>
          <dd>{originKeyed === undefined ? 'unknown' : originKeyed ? 'yes' : 'no — needs Origin-Agent-Cluster: ?1'}</dd>
          <dt>To enable</dt>
          <dd>Open in ChatGPT, or Chrome 149+ with chrome://flags/#enable-webmcp-testing</dd>
        </dl>
        <button type="button" onClick={() => window.dispatchEvent(new Event('sightline:retry-mcp'))}>
          <ArrowsClockwise size={14} /> Retry connection
        </button>
      </div>
    </div>
  );
}

export function ActivityTicker() {
  const [note, setNote] = useState('');
  const activity = useStore((state) => state.activity);
  const mcp = useStore((state) => state.mcp);
  const addFinding = useStore((state) => state.addFinding);
  const disconnected = mcp.state === 'unavailable' || mcp.state === 'error';
  const now = useStore(nowIso);

  const addNote = (event: FormEvent) => {
    event.preventDefault();
    const value = note.trim();
    if (!value) return;
    addFinding({
      title: 'Human note',
      evidence: value,
      timestamp: clock(now),
      severity: 'info',
      pinnedBy: 'human',
    });
    setNote('');
  };

  return (
    <footer className="activity-panel" aria-label="Shared incident activity">
      <div className="activity-heading">
        <div>
          <h2>Activity</h2>
          <span>WebMCP session with you</span>
        </div>
        <span className={`activity-live ${mcp.state === 'connected' ? 'is-connected' : ''}`}>
          <i aria-hidden /> {mcp.state === 'connected' ? 'Agent connected' : 'No agent host'}
        </span>
      </div>

      <ol className="activity-list" aria-live="polite">
        {disconnected && (
          <li className="activity-empty">
            <HostDiagnostic />
          </li>
        )}
        {activity.length === 0 && !disconnected ? (
          <li className="activity-empty">
            <Robot size={16} weight="fill" />
            <span>
              {mcp.state === 'connected'
                ? 'The agent is ready. Ask it to investigate the checkout p99 spike.'
                : 'Looking for a WebMCP host…'}
            </span>
          </li>
        ) : (
          activity.slice(0, disconnected ? 2 : 5).map((entry) => (
            <li key={entry.id}>
              <time
                className="activity-time"
                dateTime={new Date(entry.at).toISOString()}
                title={`Performed at ${new Date(entry.at).toLocaleString()}`}
              >
                {new Date(entry.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </time>
              <span className={`activity-actor ${entry.actor}`}>
                {entry.actor === 'agent' ? <Robot size={14} weight="fill" /> : <User size={14} weight="fill" />}
                {entry.actor === 'agent' ? 'Agent' : 'You'}
              </span>
              <span className={entry.ok ? '' : 'text-alert'}>{entry.label}</span>
              <span className="activity-detail">{entry.detail}</span>
            </li>
          ))
        )}
      </ol>

      <form className="activity-composer" onSubmit={addNote}>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a note to the incident…"
          aria-label="Add a human note to the incident timeline"
          maxLength={240}
        />
        <button type="submit" disabled={!note.trim()} aria-label="Add note">
          <ArrowRight size={16} weight="bold" />
        </button>
      </form>
    </footer>
  );
}
