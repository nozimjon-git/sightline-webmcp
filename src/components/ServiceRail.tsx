import { serviceHealth, type HealthStatus } from '../lib/analysis';
import { METRIC_UNITS } from '../data/incident';
import { nowIso, resolvedAlertIds, useStore } from '../store';
import { Pane } from './Pane';

/**
 * Severity is encoded structurally, in one hue: a critical service is filled
 * with the alert colour, a degraded one only outlined in it, a healthy one has
 * no mark at all. There is no green.
 */
function StatusMark({ status }: { status: HealthStatus }) {
  if (status === 'critical') return <span className="h-2 w-2 shrink-0 bg-alert" aria-hidden />;
  if (status === 'degraded') return <span className="h-2 w-2 shrink-0 border border-alert" aria-hidden />;
  return <span className="h-2 w-2 shrink-0 border border-line-strong" aria-hidden />;
}

export function ServiceRail() {
  const now = useStore(nowIso);
  const resolved = useStore(resolvedAlertIds);
  const selected = useStore((s) => s.selectedService);
  const metric = useStore((s) => s.metric);
  const setService = useStore((s) => s.setService);
  const health = serviceHealth(now, resolved);

  return (
    <Pane
      id="services"
      title="Services"
      compactStamp
      className="w-52 shrink-0 border-r border-line"
      bodyClassName="overflow-y-auto"
    >
      <ul>
        {health.map((h) => {
          const isSelected = h.service === selected;
          const value = metric === 'error_rate' ? h.error_rate_pct : metric === 'p50' ? h.p50_ms : h.p99_ms;
          return (
            <li key={h.service}>
              <button
                type="button"
                onClick={() => setService(h.service, 'human')}
                aria-current={isSelected}
                className={`flex w-full flex-col gap-1 border-b border-line px-3 py-2 text-left transition-colors ${
                  isSelected ? 'bg-raised' : 'hover:bg-raised/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <StatusMark status={h.status} />
                  <span className={`truncate text-xs ${isSelected ? 'text-ink' : 'text-ink-dim'}`}>{h.service}</span>
                </div>
                <div className="flex items-baseline justify-between pl-4">
                  <span className="font-mono text-2xs text-ink-faint">{metric}</span>
                  <span
                    className={`font-mono text-xs tnum ${h.status === 'critical' ? 'text-alert' : 'text-ink-dim'}`}
                  >
                    {value}
                    {METRIC_UNITS[metric]}
                  </span>
                </div>
                {h.active_alerts > 0 && (
                  <div className="pl-4 font-mono text-2xs text-ink-faint">
                    {h.active_alerts} alert{h.active_alerts > 1 ? 's' : ''} · {h.alert_names[0]}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="px-3 py-2 text-2xs leading-relaxed text-ink-faint">
        Click a service to focus the chart, traces and logs. Your agent reads this selection through{' '}
        <span className="font-mono text-ink-dim">get_current_view</span>.
      </p>
    </Pane>
  );
}
