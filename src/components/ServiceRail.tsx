import { MagnifyingGlass } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { METRIC_LABELS, METRIC_UNITS } from '../data/incident';
import { serviceHealth, type HealthStatus } from '../lib/analysis';
import { nowIso, resolvedAlertIds, useStore } from '../store';
import { useTouchFlash } from './Pane';

/**
 * Severity is encoded structurally, in one hue: a critical service is filled
 * with the alert colour, a degraded one only outlined in it, a healthy one
 * carries a bare neutral ring. There is no green.
 */
function StatusMark({ status }: { status: HealthStatus }) {
  return <span className={`service-status-dot service-status-${status}`} aria-label={status} />;
}

export function ServiceRail() {
  const [query, setQuery] = useState('');
  const now = useStore(nowIso);
  const resolved = useStore(resolvedAlertIds);
  const selected = useStore((state) => state.selectedService);
  const metric = useStore((state) => state.metric);
  const setService = useStore((state) => state.setService);
  const pulse = useTouchFlash('services');
  const health = serviceHealth(now, resolved);
  const filtered = useMemo(
    () => health.filter((item) => item.service.toLowerCase().includes(query.trim().toLowerCase())),
    [health, query],
  );

  return (
    <aside className={`service-rail ${pulse.className}`} aria-label="Services">
      <div className="service-search-wrap">
        <MagnifyingGlass size={16} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search services"
          aria-label="Search services"
        />
      </div>

      <div className="service-rail-scroll">
        <p className="rail-kicker">Affected services</p>
        <ul className="service-list">
          {filtered.map((item) => {
            const value = metric === 'error_rate' ? item.error_rate_pct : metric === 'p50' ? item.p50_ms : item.p99_ms;
            const isSelected = item.service === selected;
            return (
              <li key={item.service}>
                <button
                  type="button"
                  className={`service-button ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => setService(item.service, 'human')}
                  aria-current={isSelected ? 'true' : undefined}
                  aria-label={`${item.service}, ${item.status}, ${metric} ${value}${METRIC_UNITS[metric]}, ${item.active_alerts} active alerts`}
                >
                  <span className="service-name-row">
                    <StatusMark status={item.status} />
                    <strong>{item.service}</strong>
                  </span>
                  <span className="service-metric-row">
                    <span>{metric}</span>
                    <strong className={item.status === 'critical' ? 'text-alert' : ''}>
                      {value.toLocaleString('en-US')}{METRIC_UNITS[metric]}
                    </strong>
                  </span>
                  <span className="service-alert-row">
                    {item.active_alerts > 0
                      ? `${item.active_alerts} alert${item.active_alerts > 1 ? 's' : ''} · ${item.alert_names[0]}`
                      : 'No active alerts'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {filtered.length === 0 && <p className="service-empty">No services match “{query}”.</p>}
      </div>

      <div className="service-rail-footer">
        <span>{METRIC_LABELS[metric]}</span>
        <span className="keys-hint">
          <kbd>?</kbd> keys
        </span>
      </div>
    </aside>
  );
}
