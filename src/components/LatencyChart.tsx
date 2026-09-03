import { useMemo } from 'react';
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DEPLOYS,
  LIVE_MINUTES,
  METRIC_LABELS,
  METRIC_UNITS,
  SERIES,
  clock,
  minuteOfIso,
  type MetricName,
} from '../data/incident';
import { detectAnomalyStart } from '../lib/analysis';
import { labelFor, parseWindow } from '../lib/time';
import { mitigationMinute, nowIso, useStore } from '../store';
import { Pane } from './Pane';

const METRICS: MetricName[] = ['p99', 'p50', 'error_rate'];
const PRESETS: { label: string; value: string }[] = [
  { label: '15m', value: 'last_15m' },
  { label: '30m', value: 'last_30m' },
  { label: '60m', value: 'last_60m' },
  { label: 'all', value: 'full_incident' },
];

const COLOR = { normal: '#97a2a6', alert: '#e2724e', agent: '#8fb3c4', line: '#2a3134', faint: '#6a7579' };

interface Row {
  t: string;
  iso: string;
  vNormal: number | null;
  vAnomaly: number | null;
  vRecovery: number | null;
  v: number;
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { payload: Row }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="border border-line-strong bg-ground px-2 py-1 font-mono text-2xs tnum text-ink">
      <div className="text-ink-faint">{label} UTC</div>
      <div>
        {row.v}
        {unit}
      </div>
    </div>
  );
}

export function LatencyChart() {
  const service = useStore((s) => s.selectedService);
  const metric = useStore((s) => s.metric);
  const window = useStore((s) => s.window);
  const marked = useStore((s) => s.markedDeployIds);
  const setMetric = useStore((s) => s.setMetric);
  const setWindow = useStore((s) => s.setWindow);
  const now = useStore(nowIso);
  const mitigation = useStore(mitigationMinute);

  const lastMinute = minuteOfIso(now);

  const { rows, anomalyClock } = useMemo(() => {
    const points = SERIES[service][metric].slice(0, lastMinute + 1);
    const anomalyIso = detectAnomalyStart(points);
    const anomalyIdx = anomalyIso ? points.findIndex((p) => p.t === anomalyIso) : -1;
    const recoveryIdx = mitigation ?? Number.POSITIVE_INFINITY;

    const rows: Row[] = points.map((p, i) => ({
      t: clock(p.t),
      iso: p.t,
      v: p.v,
      // The boundary index belongs to both segments so the line does not break.
      vNormal: anomalyIdx < 0 || i <= anomalyIdx ? p.v : null,
      vAnomaly: anomalyIdx >= 0 && i >= anomalyIdx && i <= recoveryIdx ? p.v : null,
      vRecovery: i >= recoveryIdx ? p.v : null,
    }));
    return { rows, anomalyClock: anomalyIso ? clock(anomalyIso) : null };
  }, [service, metric, lastMinute, mitigation]);

  const startIndex = Math.max(0, rows.findIndex((r) => r.iso >= window.startIso));
  const endIndexRaw = rows.findIndex((r) => r.iso >= window.endIso);
  const endIndex = endIndexRaw < 0 ? rows.length - 1 : endIndexRaw;

  const onBrush = (range: { startIndex?: number; endIndex?: number }) => {
    const s = range.startIndex ?? 0;
    const e = range.endIndex ?? rows.length - 1;
    if (s === startIndex && e === endIndex) return;
    const startIso = rows[s].iso;
    const endIso = rows[e].iso;
    setWindow({ startIso, endIso, label: labelFor(startIso, endIso) }, 'human');
  };

  const unit = METRIC_UNITS[metric];
  const visible = DEPLOYS.filter((d) => minuteOfIso(d.at) <= lastMinute);

  return (
    <Pane
      id="chart"
      title={`${service} · ${METRIC_LABELS[metric]}`}
      className="h-[38%] shrink-0 border-b border-line"
      bodyClassName="flex flex-col"
      controls={
        <div className="flex items-center gap-3">
          <div className="flex">
            {METRICS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m, 'human')}
                className={`border border-line px-1.5 py-0.5 font-mono text-2xs -ml-px first:ml-0 ${
                  metric === m ? 'border-line-strong bg-raised text-ink' : 'text-ink-faint hover:text-ink-dim'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setWindow(parseWindow(p.value, now), 'human')}
                className="-ml-px border border-line px-1.5 py-0.5 font-mono text-2xs text-ink-faint first:ml-0 hover:text-ink-dim"
              >
                {p.label}
              </button>
            ))}
          </div>
          {anomalyClock && (
            <span className="font-mono text-2xs text-alert tnum">change point {anomalyClock}</span>
          )}
        </div>
      }
    >
      <div className="min-h-0 flex-1 pt-2 pr-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} syncId="sightline">
            <CartesianGrid stroke={COLOR.line} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fill: COLOR.faint, fontSize: 10, fontFamily: 'IBM Plex Mono' }}
              tickLine={false}
              axisLine={{ stroke: COLOR.line }}
              minTickGap={44}
              interval="preserveStartEnd"
            />
            <YAxis
              width={54}
              tick={{ fill: COLOR.faint, fontSize: 10, fontFamily: 'IBM Plex Mono' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}${unit}`}
            />
            <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: COLOR.faint, strokeDasharray: '2 2' }} />

            {visible.map((d) => {
              const isMarked = marked.includes(d.id);
              return (
                <ReferenceLine
                  key={d.id}
                  x={clock(d.at)}
                  stroke={isMarked ? COLOR.agent : COLOR.line}
                  strokeDasharray="3 3"
                  strokeWidth={isMarked ? 1.5 : 1}
                  label={{
                    value: isMarked ? `${d.id} ${d.version}` : d.version,
                    position: 'insideTopLeft',
                    fill: isMarked ? COLOR.agent : COLOR.faint,
                    fontSize: 9,
                    fontFamily: 'IBM Plex Mono',
                  }}
                />
              );
            })}
            {anomalyClock && <ReferenceLine x={anomalyClock} stroke={COLOR.alert} strokeWidth={1} />}
            {mitigation !== null && (
              <ReferenceLine
                x={clock(SERIES[service][metric][mitigation].t)}
                stroke={COLOR.agent}
                strokeWidth={1}
                label={{
                  value: 'rollback',
                  position: 'insideBottomRight',
                  fill: COLOR.agent,
                  fontSize: 9,
                  fontFamily: 'IBM Plex Mono',
                }}
              />
            )}

            <Line type="monotone" dataKey="vNormal" stroke={COLOR.normal} strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line type="monotone" dataKey="vAnomaly" stroke={COLOR.alert} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line
              type="monotone"
              dataKey="vRecovery"
              stroke={COLOR.agent}
              strokeWidth={1.6}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />

            <Brush
              dataKey="t"
              height={20}
              startIndex={startIndex}
              endIndex={endIndex}
              onChange={onBrush}
              stroke={COLOR.line}
              fill="#1b2023"
              travellerWidth={7}
              tickFormatter={() => ''}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="shrink-0 px-3 pb-1.5 pt-1 text-2xs text-ink-faint">
        Drag the handles under the chart to change the window. Whatever you land on is what{' '}
        <span className="font-mono text-ink-dim">get_current_view</span> hands your agent
        {lastMinute > LIVE_MINUTES ? ' · dashed segment is post-rollback telemetry' : ''}.
      </p>
    </Pane>
  );
}
