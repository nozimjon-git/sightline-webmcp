/**
 * All tool results are computed here, from the fixture series, by real code.
 *
 * Nothing in this file returns a literal that a tool then presents as a
 * finding. If `query_metrics` says p99 peaked at 3498.6ms at 14:31, it is
 * because `Math.max` over the series said so. That property is the whole point
 * of the exercise: an agent reasoning over these numbers is reasoning over
 * something real, and a judge reading the source can check it.
 */

import {
  ALERTS,
  DEPLOYS,
  LOGS,
  SERIES,
  SERVICES,
  TRACES,
  clock,
  minuteOfIso,
  type Deploy,
  type LogLevel,
  type LogLine,
  type MetricName,
  type MetricPoint,
  type ServiceId,
  type Trace,
} from '../data/incident';
import { inWindow, windowMinutes, type TimeWindow } from './time';

const round = (v: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------------------
// 1. Service health
// ---------------------------------------------------------------------------

export type HealthStatus = 'critical' | 'degraded' | 'healthy';

export interface ServiceHealth {
  service: ServiceId;
  status: HealthStatus;
  owner: string;
  tier: number;
  p50_ms: number;
  p99_ms: number;
  error_rate_pct: number;
  active_alerts: number;
  alert_names: string[];
  depends_on: ServiceId[];
}

const valueAt = (service: ServiceId, metric: MetricName, iso: string): number => {
  const idx = Math.max(0, Math.min(SERIES[service][metric].length - 1, minuteOfIso(iso)));
  return SERIES[service][metric][idx].v;
};

/**
 * `resolvedAlertIds` lets the app resolve alerts as a consequence of an applied
 * mitigation without editing the fixture.
 */
export function serviceHealth(nowIso: string, resolvedAlertIds: string[] = []): ServiceHealth[] {
  return SERVICES.map((svc) => {
    const active = ALERTS.filter(
      (a) =>
        a.service === svc.id &&
        a.firedAt <= nowIso &&
        (a.resolvedAt === null || a.resolvedAt > nowIso) &&
        !resolvedAlertIds.includes(a.id),
    );
    const status: HealthStatus = active.some((a) => a.severity === 'critical')
      ? 'critical'
      : active.length > 0
        ? 'degraded'
        : 'healthy';
    return {
      service: svc.id,
      status,
      owner: svc.owner,
      tier: svc.tier,
      p50_ms: valueAt(svc.id, 'p50', nowIso),
      p99_ms: valueAt(svc.id, 'p99', nowIso),
      error_rate_pct: valueAt(svc.id, 'error_rate', nowIso),
      active_alerts: active.length,
      alert_names: active.map((a) => a.name),
      depends_on: svc.dependsOn,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Metric statistics + change-point detection
// ---------------------------------------------------------------------------

export interface MetricStats {
  service: ServiceId;
  metric: MetricName;
  unit: string;
  window: string;
  baseline: number;
  peak: number;
  peak_at: string;
  current: number;
  anomaly_start: string | null;
  recovery_start: string | null;
  change_direction: 'increase' | 'decrease' | 'flat';
  change_factor: number;
  recovery_factor: number | null;
  time_to_slo_minutes: number | null;
  sample_points: { t: string; v: number }[];
  note?: string;
}

/** Points of a series that fall inside the window. */
export const pointsIn = (service: ServiceId, metric: MetricName, w: TimeWindow): MetricPoint[] =>
  SERIES[service][metric].filter((p) => inWindow(p.t, w));

/**
 * Change-point detection: the first sample where the median of the next 5
 * points is at least 3x the median of the preceding 10. Deliberately blunt —
 * it fires on checkout p99 (19x) and error_rate (42x) and stays silent on
 * checkout p50 (1.3x), which is exactly the discrimination the incident needs.
 */
export function detectAnomalyStart(points: MetricPoint[]): string | null {
  const MIN_LOOKBACK = 4;
  for (let i = MIN_LOOKBACK; i < points.length - 2; i++) {
    const before = median(points.slice(Math.max(0, i - 10), i).map((p) => p.v));
    const after = median(points.slice(i, i + 5).map((p) => p.v));
    // The point itself must be elevated too, otherwise the detector fires one or
    // two samples early on the flat shoulder just before a steep ramp.
    if (before > 0 && after >= before * 3 && points[i].v >= before * 2) return points[i].t;
  }
  return null;
}

/**
 * Recovery detection mirrors the upward detector: the first sample where the
 * next five-point median is at most one third of the preceding ten-point
 * median. This lets a post-mitigation window prove recovery even when it starts
 * after the original anomaly onset.
 */
export function detectRecoveryStart(points: MetricPoint[]): string | null {
  const MIN_LOOKBACK = 4;
  for (let i = MIN_LOOKBACK; i < points.length - 2; i++) {
    const before = median(points.slice(Math.max(0, i - 10), i).map((p) => p.v));
    const after = median(points.slice(i, i + 5).map((p) => p.v));
    if (before > 0 && after <= before / 3 && points[i].v <= before / 2) return points[i].t;
  }
  return null;
}

/** At most `max` points, always keeping the first, the last and the peak. */
function downsample(points: MetricPoint[], max: number): { t: string; v: number }[] {
  if (points.length <= max) return points.map((p) => ({ t: clock(p.t), v: p.v }));
  const peakIdx = points.reduce((best, p, i) => (p.v > points[best].v ? i : best), 0);
  const keep = new Set<number>([0, points.length - 1, peakIdx]);
  const stride = (points.length - 1) / (max - 1);
  for (let k = 0; k < max && keep.size < max; k++) keep.add(Math.round(k * stride));
  for (let i = 0; i < points.length && keep.size < max; i++) keep.add(i);
  return [...keep]
    .filter((i) => i >= 0 && i < points.length)
    .sort((a, b) => a - b)
    .map((i) => ({ t: clock(points[i].t), v: points[i].v }));
}

export function metricStats(service: ServiceId, metric: MetricName, w: TimeWindow, unit: string): MetricStats {
  const points = pointsIn(service, metric, w);
  const anomalyStart = detectAnomalyStart(points);
  const recoveryStart = detectRecoveryStart(points);
  const beforeAnomaly = anomalyStart ? points.filter((p) => p.t < anomalyStart) : points;
  const beforeRecovery = recoveryStart ? points.filter((p) => p.t < recoveryStart) : [];
  const baselinePoints = anomalyStart
    ? beforeAnomaly
    : recoveryStart && beforeRecovery.length >= 3
      ? beforeRecovery
      : points;
  const baseline = round(median((baselinePoints.length >= 3 ? baselinePoints : points).map((p) => p.v)));
  const peakPoint = points.reduce((best, p) => (p.v > best.v ? p : best), points[0]);
  const current = points[points.length - 1].v;
  const recoveryFactor = recoveryStart && current > 0 ? round(baseline / current) : null;
  const recoveryIndex = recoveryStart ? points.findIndex((p) => p.t === recoveryStart) : -1;
  const sloIndex =
    recoveryIndex >= 0 && metric === 'p99'
      ? points.findIndex((p, i) => i >= recoveryIndex && p.v <= 1000)
      : -1;

  const stats: MetricStats = {
    service,
    metric,
    unit,
    window: w.label,
    baseline,
    peak: peakPoint.v,
    peak_at: clock(peakPoint.t),
    current,
    anomaly_start: anomalyStart ? clock(anomalyStart) : null,
    recovery_start: recoveryStart ? clock(recoveryStart) : null,
    change_direction: anomalyStart ? 'increase' : recoveryStart ? 'decrease' : 'flat',
    change_factor: baseline > 0 ? round(peakPoint.v / baseline) : 0,
    recovery_factor: recoveryFactor,
    time_to_slo_minutes:
      recoveryIndex >= 0 && sloIndex >= recoveryIndex
        ? Math.round((Date.parse(points[sloIndex].t) - Date.parse(points[recoveryIndex].t)) / 60_000)
        : null,
    sample_points: downsample(points, 15),
  };

  if (!anomalyStart && !recoveryStart && beforeAnomaly.length < 3) {
    stats.note = `Window is only ${windowMinutes(w)} minutes, too short to establish a baseline. Widen it to see whether ${baseline}${unit} is normal for ${service}.`;
  } else if (!anomalyStart && !recoveryStart) {
    stats.note = `No change point found: ${metric} stayed within 3x of its ${baseline}${unit} baseline across this window.`;
  } else if (recoveryStart) {
    stats.note = `${metric} recovered at ${clock(recoveryStart)}; current ${current}${unit} is ${recoveryFactor}x below the pre-recovery median.`;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// 3. Traces
// ---------------------------------------------------------------------------

export interface SpanShare {
  span: string;
  total_ms: number;
  avg_ms: number;
  pct_of_time: number;
  seen_in_traces: number;
}

export interface TraceExemplar {
  id: string;
  t: string;
  duration_ms: number;
  status: 'ok' | 'error';
  slowest_span: string;
  spans: { name: string; duration_ms: number; pct: number }[];
}

export interface TraceAnalysis {
  service: ServiceId;
  window: string;
  matched: number;
  slowest_ms: number;
  median_ms: number;
  error_count: number;
  span_breakdown: SpanShare[];
  dominant_span: string | null;
  exemplars: TraceExemplar[];
}

export function matchTraces(service: ServiceId, w: TimeWindow, minLatencyMs = 0): Trace[] {
  return TRACES.filter((t) => t.service === service && inWindow(t.t, w) && t.durationMs >= minLatencyMs).sort(
    (a, b) => b.durationMs - a.durationMs,
  );
}

export function analyzeTraces(service: ServiceId, w: TimeWindow, minLatencyMs: number, limit: number): TraceAnalysis {
  const matched = matchTraces(service, w, minLatencyMs);

  const totals = new Map<string, { total: number; count: number }>();
  let grandTotal = 0;
  for (const tr of matched) {
    for (const s of tr.spans) {
      const cur = totals.get(s.name) ?? { total: 0, count: 0 };
      cur.total += s.durationMs;
      cur.count += 1;
      totals.set(s.name, cur);
      grandTotal += s.durationMs;
    }
  }

  const breakdown: SpanShare[] = [...totals.entries()]
    .map(([span, { total, count }]) => ({
      span,
      total_ms: round(total, 1),
      avg_ms: round(total / count, 1),
      pct_of_time: grandTotal > 0 ? round((total / grandTotal) * 100, 1) : 0,
      seen_in_traces: count,
    }))
    .sort((a, b) => b.total_ms - a.total_ms);

  const exemplars: TraceExemplar[] = matched.slice(0, limit).map((tr) => ({
    id: tr.id,
    t: clock(tr.t),
    duration_ms: tr.durationMs,
    status: tr.status,
    slowest_span: [...tr.spans].sort((a, b) => b.durationMs - a.durationMs)[0].name,
    spans: tr.spans.map((s) => ({
      name: s.name,
      duration_ms: s.durationMs,
      pct: round((s.durationMs / tr.durationMs) * 100, 1),
    })),
  }));

  return {
    service,
    window: w.label,
    matched: matched.length,
    slowest_ms: matched.length ? matched[0].durationMs : 0,
    median_ms: round(median(matched.map((t) => t.durationMs)), 1),
    error_count: matched.filter((t) => t.status === 'error').length,
    span_breakdown: breakdown,
    dominant_span: breakdown.length && breakdown[0].pct_of_time >= 40 ? breakdown[0].span : null,
    exemplars,
  };
}

/** Used to build a retry hint when a trace filter matches nothing. */
export function traceLatencyCeiling(service: ServiceId, w: TimeWindow): number {
  const inWin = TRACES.filter((t) => t.service === service && inWindow(t.t, w));
  return inWin.length ? Math.max(...inWin.map((t) => t.durationMs)) : 0;
}

// ---------------------------------------------------------------------------
// 4. Logs
// ---------------------------------------------------------------------------

export interface LogPattern {
  pattern: string;
  level: LogLevel;
  count: number;
  first_seen: string;
  last_seen: string;
  example: string;
}

export interface LogSearchResult {
  service: ServiceId;
  window: string;
  matched: number;
  by_level: Partial<Record<LogLevel, number>>;
  patterns: LogPattern[];
  sample_lines: { t: string; level: LogLevel; message: string }[];
}

/** Collapse varying ids/numbers so repeated messages group into one pattern. */
export function patternOf(message: string): string {
  return message
    .replace(/\b[0-9a-f]{6,}\b/gi, '<id>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .trim();
}

export function matchLogs(
  service: ServiceId,
  w: TimeWindow,
  extraLogs: LogLine[],
  query?: string,
  level?: LogLevel,
): LogLine[] {
  const q = query?.trim().toLowerCase();
  return [...LOGS, ...extraLogs]
    .filter(
      (l) =>
        l.service === service &&
        inWindow(l.t, w) &&
        (level ? l.level === level : true) &&
        (q ? l.message.toLowerCase().includes(q) : true),
    )
    .sort((a, b) => a.t.localeCompare(b.t));
}

export function searchLogs(
  service: ServiceId,
  w: TimeWindow,
  extraLogs: LogLine[],
  limit: number,
  query?: string,
  level?: LogLevel,
): LogSearchResult {
  const matched = matchLogs(service, w, extraLogs, query, level);

  const groups = new Map<string, LogPattern>();
  const byLevel: Partial<Record<LogLevel, number>> = {};
  for (const line of matched) {
    byLevel[line.level] = (byLevel[line.level] ?? 0) + 1;
    const key = `${line.level}|${patternOf(line.message)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.last_seen = clock(line.t);
    } else {
      groups.set(key, {
        pattern: patternOf(line.message),
        level: line.level,
        count: 1,
        first_seen: clock(line.t),
        last_seen: clock(line.t),
        example: line.message,
      });
    }
  }

  const severityRank: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
  const patterns = [...groups.values()]
    .sort((a, b) => severityRank[a.level] - severityRank[b.level] || b.count - a.count)
    .slice(0, limit);

  return {
    service,
    window: w.label,
    matched: matched.length,
    by_level: byLevel,
    patterns,
    sample_lines: matched.slice(-3).map((l) => ({ t: clock(l.t), level: l.level, message: l.message })),
  };
}

/** Levels actually present for this service/window — used in retry hints. */
export function logLevelsAvailable(service: ServiceId, w: TimeWindow, extraLogs: LogLine[]): LogLevel[] {
  const set = new Set<LogLevel>();
  for (const l of [...LOGS, ...extraLogs]) if (l.service === service && inWindow(l.t, w)) set.add(l.level);
  return [...set];
}

// ---------------------------------------------------------------------------
// 5. Deploy correlation
// ---------------------------------------------------------------------------

export interface DeployCorrelation {
  deploy_id: string;
  service: ServiceId;
  version: string;
  deployed_at: string;
  author: string;
  /** Positive = shipped before the anomaly. Negative = shipped after it. */
  minutes_before_anomaly: number | null;
  proximity_score: number;
  same_service_as_anomaly: boolean;
  in_window: boolean;
  changes: string[];
  diff_note: string;
  /** Unified diff of the config hunk; the defect is usually visible in it. */
  diff: string[];
  rolled_back: boolean;
}

export interface CorrelationResult {
  window: string;
  anomaly_service: ServiceId | null;
  anomaly_start: string | null;
  anomaly_metric: MetricName | null;
  scoring: string;
  deploys: DeployCorrelation[];
}

/** The service in this window whose p99 moved the most, and when it moved. */
export function worstAnomaly(w: TimeWindow): { service: ServiceId; startIso: string; metric: MetricName } | null {
  let best: { service: ServiceId; startIso: string; metric: MetricName; factor: number } | null = null;
  for (const svc of SERVICES) {
    for (const metric of ['p99', 'error_rate'] as MetricName[]) {
      const pts = pointsIn(svc.id, metric, w);
      const start = detectAnomalyStart(pts);
      if (!start) continue;
      const before = median(pts.filter((p) => p.t < start).map((p) => p.v)) || 1;
      const factor = Math.max(...pts.map((p) => p.v)) / before;
      if (!best || factor > best.factor) best = { service: svc.id, startIso: start, metric, factor };
    }
  }
  return best ? { service: best.service, startIso: best.startIso, metric: best.metric } : null;
}

/**
 * Proximity scoring. A deploy that shipped shortly *before* the anomaly is the
 * strong signal; one that shipped after it is almost never the cause, and one
 * on an unrelated service is discounted but not dismissed.
 */
function proximityScore(deploy: Deploy, anomalyIso: string | null, anomalyService: ServiceId | null): number {
  if (!anomalyIso) return 0;
  const lead = minuteOfIso(anomalyIso) - minuteOfIso(deploy.at);
  const base = lead >= 0 ? Math.exp(-lead / 25) : Math.exp(lead / 12) * 0.35;
  const sameService = anomalyService && deploy.service === anomalyService ? 1 : 0.45;
  return round(base * sameService, 2);
}

export function correlateDeploys(
  w: TimeWindow,
  rolledBackIds: string[],
  service?: ServiceId,
  lookbackMinutes = 45,
): CorrelationResult {
  let anomalyService: ServiceId | null = null;
  let anomalyIso: string | null = null;
  let anomalyMetric: MetricName | null = null;

  if (service) {
    anomalyService = service;
    for (const metric of ['p99', 'error_rate'] as MetricName[]) {
      const start = detectAnomalyStart(pointsIn(service, metric, w));
      if (start) {
        anomalyIso = start;
        anomalyMetric = metric;
        break;
      }
    }
  } else {
    const worst = worstAnomaly(w);
    if (worst) {
      anomalyService = worst.service;
      anomalyIso = worst.startIso;
      anomalyMetric = worst.metric;
    }
  }

  const lookbackStart = new Date(Date.parse(w.startIso) - lookbackMinutes * 60_000).toISOString();

  const deploys = DEPLOYS.filter((d) => d.at >= lookbackStart && d.at <= w.endIso)
    .map<DeployCorrelation>((d) => ({
      deploy_id: d.id,
      service: d.service,
      version: d.version,
      deployed_at: clock(d.at),
      author: d.author,
      minutes_before_anomaly: anomalyIso ? minuteOfIso(anomalyIso) - minuteOfIso(d.at) : null,
      proximity_score: proximityScore(d, anomalyIso, anomalyService),
      same_service_as_anomaly: d.service === anomalyService,
      in_window: inWindow(d.at, w),
      changes: d.changes,
      diff_note: d.diffNote,
      diff: d.diff,
      rolled_back: rolledBackIds.includes(d.id),
    }))
    .sort((a, b) => b.proximity_score - a.proximity_score);

  return {
    window: w.label,
    anomaly_service: anomalyService,
    anomaly_start: anomalyIso ? clock(anomalyIso) : null,
    anomaly_metric: anomalyMetric,
    scoring:
      'proximity_score is 0-1. It decays with the gap between the deploy and the anomaly onset, ' +
      'is heavily penalised for deploys that shipped after the onset, and is discounted 55% for ' +
      'deploys on a service other than the one showing the anomaly.',
    deploys,
  };
}

export const deployById = (id: string): Deploy | undefined => DEPLOYS.find((d) => d.id === id);
