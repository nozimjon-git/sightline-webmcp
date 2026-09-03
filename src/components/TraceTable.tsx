import { analyzeTraces, matchTraces } from '../lib/analysis';
import { TRACES, clock } from '../data/incident';
import { useStore } from '../store';
import { Empty, Pane } from './Pane';

const COLOR_FOR = (name: string, dominant: string | null) =>
  name === dominant ? 'bg-alert' : 'bg-line-strong';

export function TraceTable() {
  const service = useStore((s) => s.selectedService);
  const window = useStore((s) => s.window);
  const minLatency = useStore((s) => s.traceMinLatencyMs);
  // The exemplar count the agent asked for. The table itself scrolls through
  // every match; this only sizes the exemplar list inside the analysis.
  const limit = useStore((s) => s.traceLimit);
  const selectedId = useStore((s) => s.selectedTraceId);
  const selectTrace = useStore((s) => s.selectTrace);
  const setTraceFilter = useStore((s) => s.setTraceFilter);

  const matched = matchTraces(service, window, minLatency);
  const analysis = matched.length ? analyzeTraces(service, window, minLatency, limit) : null;
  const selected = selectedId ? TRACES.find((t) => t.id === selectedId) : undefined;

  return (
    <Pane
      id="traces"
      title="Traces"
      className="trace-pane h-[29%] min-h-[11rem] shrink-0 border-b border-line"
      bodyClassName="trace-body flex min-h-0"
      controls={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-2xs text-ink-faint">
            min
            <input
              type="number"
              min={0}
              step={100}
              value={minLatency}
              onChange={(e) => setTraceFilter({ minLatencyMs: Math.max(0, Number(e.target.value) || 0) }, 'human')}
              className="control-hit w-16 border border-line bg-ground px-1.5 font-mono text-2xs tnum text-ink"
            />
            ms
          </label>
          <span className="shrink-0 font-mono text-2xs tnum whitespace-nowrap text-ink-faint">
            {matched.length} match{matched.length === 1 ? '' : 'es'}
          </span>
        </div>
      }
    >
      {matched.length === 0 ? (
        <Empty>
          No traces for {service} at or above {minLatency}ms in {window.label}. Lower the threshold or widen the
          window.
        </Empty>
      ) : (
        <>
          <div className="min-w-0 flex-1 overflow-auto">
            {/* The span column drops out below 1400px, so the floor is the width
                of the three columns that always remain, not of all four. */}
            <table className="w-full min-w-[21rem] border-collapse">
              <thead className="sticky top-0 bg-pane">
                <tr className="border-b border-line text-left text-2xs text-ink-faint">
                  <th className="px-3 py-1 font-normal">trace</th>
                  <th className="px-2 py-1 font-normal">at</th>
                  <th className="px-2 py-1 text-right font-normal">duration</th>
                  <th className="trace-col-span px-2 py-1 font-normal">slowest span</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((t) => {
                  const slowest = [...t.spans].sort((a, b) => b.durationMs - a.durationMs)[0];
                  const isSel = t.id === selectedId;
                  return (
                    <tr
                      key={t.id}
                      tabIndex={0}
                      aria-selected={isSel}
                      onClick={() => selectTrace(t.id, 'human')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectTrace(t.id, 'human');
                        }
                      }}
                      className={`cursor-pointer border-b border-line/60 ${isSel ? 'bg-raised' : 'hover:bg-raised/50'}`}
                    >
                      <td className="px-3 py-1 font-mono text-2xs text-ink-dim">
                        {t.status === 'error' && <span className="mr-1.5 inline-block h-1.5 w-1.5 bg-alert align-middle" aria-hidden />}
                        {t.id.slice(3)}
                      </td>
                      <td className="px-2 py-1 font-mono text-2xs tnum text-ink-faint">{clock(t.t)}</td>
                      <td
                        className={`px-2 py-1 text-right font-mono text-2xs tnum ${t.durationMs > 1000 ? 'text-alert' : 'text-ink-dim'}`}
                      >
                        {t.durationMs.toLocaleString('en-US')}ms
                      </td>
                      <td className="trace-col-span truncate px-2 py-1 font-mono text-2xs text-ink-faint">{slowest.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <aside className="trace-detail w-72 shrink-0 overflow-y-auto border-l border-line px-3 py-2.5">
            {selected ? (
              <>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => selectTrace(null, 'human')}
                    className="control-hit font-mono text-2xs text-ink-dim hover:text-ink"
                    title="Back to the aggregate across all matching traces"
                  >
                    ← {selected.id.slice(3)}
                  </button>
                  <span className="font-mono text-2xs tnum text-ink">{selected.durationMs.toLocaleString('en-US')}ms</span>
                </div>
                <ul className="space-y-1.5">
                  {selected.spans.map((sp) => {
                    const pct = (sp.durationMs / selected.durationMs) * 100;
                    return (
                      <li key={sp.name}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-mono text-2xs text-ink-dim">{sp.name}</span>
                          <span className="shrink-0 font-mono text-2xs tnum text-ink-faint">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="mt-0.5 h-1 w-full bg-ground">
                          <div
                            className={`h-1 ${COLOR_FOR(sp.name, analysis?.dominant_span ?? null)}`}
                            style={{ width: `${Math.max(0.8, pct)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {selected.error && (
                  <p className="mt-2 border-l border-alert pl-2 font-mono text-2xs leading-relaxed text-alert">
                    {selected.error}
                  </p>
                )}
              </>
            ) : (
              <div className="text-2xs leading-relaxed text-ink-faint">
                <p className="mb-2">
                  Aggregate across all {matched.length} matching traces — where the time actually goes.
                </p>
                <ul className="space-y-1.5">
                  {analysis?.span_breakdown.map((b) => (
                    <li key={b.span}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-2xs text-ink-dim">{b.span}</span>
                        <span className="shrink-0 font-mono text-2xs tnum text-ink-faint">{b.pct_of_time}%</span>
                      </div>
                      <div className="mt-0.5 h-1 w-full bg-ground">
                        <div
                          className={`h-1 ${COLOR_FOR(b.span, analysis.dominant_span)}`}
                          style={{ width: `${Math.max(0.8, b.pct_of_time)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2">Select a row to see one trace's spans.</p>
              </div>
            )}
          </aside>
        </>
      )}
    </Pane>
  );
}
