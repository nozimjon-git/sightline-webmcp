import { ArrowRight, Robot, User } from '@phosphor-icons/react';
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
const stampOf = (entry: { at: number }) =>
  new Date(entry.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function ActivityTicker() {
  const [note, setNote] = useState('');
  const activity = useStore((state) => state.activity);
  const mcp = useStore((state) => state.mcp);
  const addFinding = useStore((state) => state.addFinding);
  const now = useStore(nowIso);

    // Four fits the band exactly. A fifth row half-cut behind a scrollbar reads
  // as a bug, and the full trail is the postmortem's job, not the ticker's.
  const rows = activity.slice(0, 4);

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
        <h2>Activity</h2>
        <span className={`activity-live ${mcp.state === 'connected' ? 'is-connected' : ''}`}>
          <i aria-hidden /> {mcp.state === 'connected' ? 'Agent connected' : 'No agent host'}
        </span>
      </div>

      <ol className="activity-list" aria-live="polite">
        {activity.length === 0 ? (
          <li className="activity-empty">
            <Robot size={16} weight="fill" />
            <span>
              {mcp.state === 'connected'
                ? 'The agent is ready. Ask it to investigate the checkout p99 spike.'
                : mcp.state === 'checking'
                  ? 'Looking for a WebMCP host…'
                  : 'Nothing has run yet. Drive the console by hand, or connect a host to let an agent help.'}
            </span>
          </li>
        ) : (
          rows.map((entry, index) => (
            <li key={entry.id}>
              {/* A burst of tool calls lands in the same second. Printing the
                  same stamp five times down the column buries the tool names
                  the reader is actually scanning, so a repeat goes quiet. */}
              <time
                className={`activity-time ${index > 0 && stampOf(rows[index - 1]) === stampOf(entry) ? 'is-repeat' : ''}`}
                dateTime={new Date(entry.at).toISOString()}
                title={`Performed at ${new Date(entry.at).toLocaleString()}`}
              >
                {stampOf(entry)}
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
