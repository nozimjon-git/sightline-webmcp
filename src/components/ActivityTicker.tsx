import { ArrowRight, Robot, User } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { clock } from '../data/incident';
import { nowIso, useStore } from '../store';

export function ActivityTicker() {
  const [note, setNote] = useState('');
  const activity = useStore((state) => state.activity);
  const mcp = useStore((state) => state.mcp);
  const addFinding = useStore((state) => state.addFinding);
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
        {activity.length === 0 ? (
          <li className="activity-empty">
            <Robot size={16} weight="fill" />
            <span>{mcp.state === 'connected' ? 'The agent is ready. Ask it to investigate the checkout p99 spike.' : 'No agent host detected. Explore the incident by hand or connect a WebMCP host.'}</span>
          </li>
        ) : (
          activity.slice(0, 4).map((entry) => (
            <li key={entry.id}>
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
