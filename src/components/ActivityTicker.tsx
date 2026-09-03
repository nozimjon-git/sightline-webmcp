import { useStore } from '../store';

/**
 * The instrument strip along the bottom: the last few things either party did,
 * newest on the left. It is the only place agent and human actions appear in
 * one sequence, which is what makes a tool call legible on video.
 */
export function ActivityTicker() {
  const activity = useStore((s) => s.activity);
  const mcp = useStore((s) => s.mcp);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 overflow-hidden border-t border-line bg-pane px-3">
      <span className="shrink-0 text-2xs text-ink-faint">activity</span>
      {activity.length === 0 ? (
        <span className="font-mono text-2xs text-ink-faint">
          {mcp.state === 'connected'
            ? 'waiting for the agent — try "Checkout p99 is spiking. Find out why."'
            : 'no agent host detected; the console is fully usable by hand'}
        </span>
      ) : (
        <ol className="flex min-w-0 items-center gap-3">
          {activity.slice(0, 6).map((e) => (
            <li key={e.id} className="flex shrink-0 items-baseline gap-1.5 font-mono text-2xs">
              <span className={e.actor === 'agent' ? 'text-agent' : 'text-ink-dim'}>
                {e.actor === 'agent' ? 'agent' : 'you'}
              </span>
              <span className={e.ok ? 'text-ink-dim' : 'text-alert'}>{e.label}</span>
              <span className="max-w-[30ch] truncate text-ink-faint">{e.detail}</span>
              {activity.indexOf(e) < Math.min(activity.length, 6) - 1 && <span className="text-line-strong">/</span>}
            </li>
          ))}
        </ol>
      )}
    </footer>
  );
}
