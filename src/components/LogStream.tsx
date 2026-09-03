import { useEffect, useRef } from 'react';
import { matchLogs } from '../lib/analysis';
import { clock, type LogLevel } from '../data/incident';
import { extraLogs, useStore } from '../store';
import { Empty, Pane } from './Pane';

const LEVELS: (LogLevel | 'all')[] = ['all', 'error', 'warn', 'info', 'debug'];

const LEVEL_STYLE: Record<LogLevel, string> = {
  error: 'text-alert',
  warn: 'text-ink',
  info: 'text-ink-dim',
  debug: 'text-ink-faint',
};

export function LogStream() {
  const service = useStore((s) => s.selectedService);
  const window = useStore((s) => s.window);
  const query = useStore((s) => s.logQuery);
  const level = useStore((s) => s.logLevel);
  const setLogFilter = useStore((s) => s.setLogFilter);
  const extras = useStore(extraLogs);
  const pulse = useStore((s) => s.pulses.logs);

  const lines = matchLogs(service, window, extras, query || undefined, level === 'all' ? undefined : level);
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the tail whenever the filter changes, the way a log viewer should.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [pulse, lines.length]);

  return (
    <Pane
      id="logs"
      title="Logs"
      className="min-h-0 flex-1"
      bodyClassName="min-h-0"
      controls={
        <div className="flex min-w-0 items-center gap-2">
          <input
            type="search"
            value={query}
            placeholder="filter…"
            onChange={(e) => setLogFilter({ query: e.target.value }, 'human')}
            className="w-40 border border-line bg-ground px-1.5 py-0.5 font-mono text-2xs text-ink placeholder:text-ink-faint"
          />
          <div className="flex">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLogFilter({ level: l }, 'human')}
                className={`-ml-px border border-line px-1.5 py-0.5 font-mono text-2xs first:ml-0 ${
                  level === l ? 'border-line-strong bg-raised text-ink' : 'text-ink-faint hover:text-ink-dim'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <span className="shrink-0 font-mono text-2xs tnum text-ink-faint">{lines.length} lines</span>
        </div>
      }
    >
      {lines.length === 0 ? (
        <Empty>
          Nothing in {service} logs for {window.label}
          {query ? ` matching "${query}"` : ''}
          {level !== 'all' ? ` at ${level}` : ''}. Clear the filter or widen the window.
        </Empty>
      ) : (
        <div ref={scroller} className="h-full overflow-y-auto px-3 py-1">
          {lines.map((l) => (
            <div key={l.id} className="flex gap-2 py-px font-mono text-2xs leading-snug">
              <span className="shrink-0 tnum text-ink-faint">{clock(l.t)}</span>
              <span className={`w-9 shrink-0 ${LEVEL_STYLE[l.level]}`}>{l.level}</span>
              <span className={`min-w-0 break-words ${l.level === 'error' ? 'text-alert' : 'text-ink-dim'}`}>
                {l.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </Pane>
  );
}
