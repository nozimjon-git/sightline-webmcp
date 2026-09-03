/**
 * The nine WebMCP tools.
 *
 * Three rules hold for every one of them:
 *
 * 1. The result is computed from the fixture series by `src/lib/analysis.ts`.
 *    No tool returns a literal that it presents as a measurement.
 * 2. Every tool changes something on screen. Read tools select, filter and
 *    repaint; write tools mutate durable incident state. A tool call the human
 *    cannot see happening is a tool call they cannot supervise.
 * 3. Every tool calls the same store actions the buttons call.
 *
 * Errors are *returned*, never thrown past the wrapper, and they say what to do
 * next. The spec discards a rejected execute promise's reason, so throwing
 * would silently destroy the retry hint.
 */

import {
  DEPLOYS,
  INCIDENT,
  LIVE_MINUTES,
  METRIC_UNITS,
  SERVICE_IDS,
  TRACES,
  clock,
  isoAtMinute,
  type LogLevel,
  type MetricName,
  type ServiceId,
} from '../data/incident';
import {
  analyzeTraces,
  correlateDeploys,
  deployById,
  logLevelsAvailable,
  matchLogs,
  matchTraces,
  metricStats,
  searchLogs,
  serviceHealth,
  traceLatencyCeiling,
} from '../lib/analysis';
import { buildReport } from '../lib/report';
import { parseWindow, type TimeWindow } from '../lib/time';
import type { JsonSchema, ToolDefinition, ToolResult } from '../lib/webmcp';
import {
  extraLogs,
  nowIso,
  resolvedAlertIds,
  rolledBackDeployIds,
  useStore,
  withToolName,
  type Severity,
} from '../store';

const state = () => useStore.getState();

const unhealthyCount = (health: { status: string }[]) => health.filter((h) => h.status !== 'healthy').length;

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

/** A one-line headline the model reads first, then the structured payload. */
const ok = (headline: string, payload: unknown): ToolResult => ({
  content: [{ type: 'text', text: `${headline}\n${JSON.stringify(payload)}` }],
});

const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/** Thrown by validators; the wrapper turns it into a teaching error result. */
class ToolError extends Error {}

// ---------------------------------------------------------------------------
// Input validation. Each message tells the caller exactly how to retry.
// ---------------------------------------------------------------------------

function readService(raw: unknown, field: string, required: boolean): ServiceId | undefined {
  if (raw === undefined || raw === null || raw === '') {
    if (!required) return undefined;
    throw new ToolError(`Missing "${field}". Pass one of: ${SERVICE_IDS.join(', ')}.`);
  }
  const value = String(raw).trim();
  if ((SERVICE_IDS as string[]).includes(value)) return value as ServiceId;
  const near = SERVICE_IDS.find((s) => s.startsWith(value) || value.startsWith(s.split('-')[0]));
  throw new ToolError(
    `"${value}" is not a known service. Valid values: ${SERVICE_IDS.join(', ')}.` +
      (near ? ` Did you mean "${near}"?` : ''),
  );
}

function readEnum<T extends string>(raw: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if (raw === undefined || raw === null || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new ToolError(`Missing "${field}". Pass one of: ${allowed.join(', ')}.`);
  }
  const value = String(raw).trim().toLowerCase() as T;
  if (allowed.includes(value)) return value;
  throw new ToolError(`"${raw}" is not a valid ${field}. Valid values: ${allowed.join(', ')}.`);
}

function readInt(raw: unknown, field: string, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ToolError(`"${field}" must be a number between ${min} and ${max}. Got "${raw}".`);
  return Math.min(max, Math.max(min, Math.round(n)));
}

function readWindow(raw: unknown): TimeWindow {
  return parseWindow(raw === undefined || raw === null ? undefined : String(raw), nowIso(state()));
}

/** Accepts "14:20", "14:20:00" or a full ISO timestamp; returns "14:20". */
function readClock(raw: unknown, field: string): string {
  const value = String(raw ?? '').trim();
  const hhmm = /^(\d{1,2}):(\d{2})(:\d{2})?$/.exec(value);
  if (hhmm) return `${hhmm[1].padStart(2, '0')}:${hhmm[2]}`;
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(11, 16);
  throw new ToolError(
    `Could not read "${value}" as a time for "${field}". Use a 24-hour clock time on the incident day, such as "14:20", or a full ISO timestamp.`,
  );
}

// ---------------------------------------------------------------------------
// Tool wrapper: activity logging, pane pulses, and the no-throw guarantee
// ---------------------------------------------------------------------------

interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
  /**
   * Set where a tool returns text an outside party could have influenced. Log
   * messages in any real system contain attacker-supplied strings, so the host
   * should treat this tool's output as data rather than as instructions.
   */
  untrustedContent?: boolean;
  /** Short line for the human-visible activity feed. */
  summarize: (input: Record<string, unknown>) => string;
  run: (input: Record<string, unknown>) => ToolResult;
}

function defineTool(spec: ToolSpec): ToolDefinition {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: { readOnlyHint: spec.readOnly, untrustedContentHint: spec.untrustedContent ?? false },
    execute: async (input) => {
      const args = (input ?? {}) as Record<string, unknown>;
      try {
        // Panes touched during this call stamp themselves with the tool name.
        const result = withToolName(spec.name, () => spec.run(args));
        state().logActivity({
          actor: 'agent',
          label: spec.name,
          detail: spec.summarize(args),
          ok: !result.isError,
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state().logActivity({ actor: 'agent', label: spec.name, detail: message, ok: false });
        return fail(message);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------

const serviceProp = {
  type: 'string',
  enum: SERVICE_IDS,
  description: 'Which service to look at. Use get_service_health first if you do not know which one is failing.',
};

const windowProp = {
  type: 'string',
  description:
    'Time range to analyse. Accepts a preset ("last_10m", "last_15m", "last_30m", "last_60m", "last_90m", "full_incident"), ' +
    'a clock range on the incident day such as "14:00-14:30", or an ISO range such as ' +
    '"2026-09-03T14:00:00Z/2026-09-03T14:30:00Z". Defaults to "full_incident". ' +
    'All incident telemetry lies between 13:30 and 15:00 UTC on 2026-09-03.',
};

// ---------------------------------------------------------------------------
// 1. get_service_health
// ---------------------------------------------------------------------------

const getServiceHealth = defineTool({
  name: 'get_service_health',
  title: 'Service health overview',
  readOnly: true,
  description:
    'Start here. Returns every service in the checkout stack with its current status (critical, degraded or healthy), ' +
    'current p50 and p99 latency in milliseconds, current error rate as a percentage, the names of any alerts firing ' +
    'right now, and what each service depends on. Use it before querying metrics: more than one service looks slightly ' +
    'off in this incident and only one of them is the actual problem. ' +
    'You are working in a console the on-call engineer is watching, and they cannot see this conversation. Anything ' +
    'you conclude reaches them only if you pin it with pin_finding, and any action you want taken only reaches them ' +
    'through propose_rollback. Investigating without doing both leaves them with nothing. ' +
    'Side effect: selects the most severely affected service in the on-screen console so the on-call engineer can see ' +
    'what you are working on.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => 'surveyed all services',
  run: () => {
    const s = state();
    const health = serviceHealth(nowIso(s), resolvedAlertIds(s));
    const rank = { critical: 0, degraded: 1, healthy: 2 } as const;
    const worst = [...health].sort((a, b) => rank[a.status] - rank[b.status])[0];

    s.touch('services', 'agent', `${unhealthyCount(health)} unhealthy`);
    if (worst.status !== 'healthy' && worst.service !== s.selectedService) {
      s.setService(worst.service, 'agent');
    }

    const unhealthy = health.filter((h) => h.status !== 'healthy');
    return ok(
      unhealthy.length
        ? `${unhealthy.length} of ${health.length} services unhealthy. Worst: ${worst.service} (${worst.status}, p99 ${worst.p99_ms}ms, ${worst.error_rate_pct}% errors).`
        : `All ${health.length} services healthy as of ${clock(nowIso(s))}.`,
      {
        incident: INCIDENT.id,
        as_of: clock(nowIso(s)),
        services: health,
        next: unhealthy.length
          ? `Compare p99 against p50 on ${worst.service} with query_metrics. A p99 that moves far more than p50 means requests are queueing for a shared resource rather than doing more work. Pin what you establish as you go — the engineer reads the timeline, not your replies.`
          : 'Nothing is alerting. Widen the window on query_metrics if you are investigating something already resolved.',
      },
    );
  },
});

// ---------------------------------------------------------------------------
// 2. query_metrics
// ---------------------------------------------------------------------------

const METRICS = ['p50', 'p99', 'error_rate'] as const;

const queryMetrics = defineTool({
  name: 'query_metrics',
  title: 'Query a metric series',
  readOnly: true,
  description:
    'Get the shape of one metric for one service over a time range, as a statistical summary rather than a raw series: ' +
    'baseline (the median before any detected change point), peak and peak_at, the current value, anomaly_start ' +
    '(the minute a change point was detected, or null if the metric never moved), change_factor (peak divided by ' +
    'baseline), and at most 15 downsampled sample points. ' +
    'Read metrics against each other rather than one at a time. A service whose p99 moves far more than its p50 is ' +
    'queueing for a contended resource; a service whose p50 and p99 move together is genuinely doing more work per ' +
    'request. That distinction usually decides where to look next. ' +
    'Note that p50 and p99 are computed over successful responses only — requests that time out are counted in ' +
    'error_rate, not in the latency histogram. ' +
    'Side effect: repaints the on-screen chart to this service, metric and window.',
  inputSchema: {
    type: 'object',
    properties: {
      service: serviceProp,
      metric: {
        type: 'string',
        enum: METRICS,
        description:
          'Which metric. "p50" is median latency in ms, "p99" is 99th-percentile latency in ms, "error_rate" is the ' +
          'percentage of requests that failed.',
      },
      window: windowProp,
    },
    required: ['service', 'metric'],
    additionalProperties: false,
  },
  summarize: (a) => `${a.service} ${a.metric} over ${a.window ?? 'full_incident'}`,
  run: (a) => {
    const service = readService(a.service, 'service', true)!;
    const metric = readEnum<MetricName>(a.metric, METRICS, 'metric');
    const w = readWindow(a.window);

    const s = state();
    s.setService(service, 'agent');
    s.setMetric(metric, 'agent');
    s.setWindow(w, 'agent');

    const stats = metricStats(service, metric, w, METRIC_UNITS[metric]);
    const next = stats.anomaly_start
      ? `Pin this with pin_finding so the engineer sees it. Then read the counterpart metric: if ${metric === 'p99' ? 'p50 stayed flat while p99 moved' : 'p99 moved much further than this'}, the time is spent waiting, and filter_traces will show what it is waiting on.`
      : `No change point here. If this was a lead you were testing, pin it as ruled out with pin_finding at severity "warning" — a discarded hypothesis is worth as much to the engineer as a confirmed one.`;
    const headline = stats.anomaly_start
      ? `${service} ${metric} changed at ${stats.anomaly_start}: ${stats.baseline}${stats.unit} baseline -> ${stats.peak}${stats.unit} peak (${stats.change_factor}x).`
      : `${service} ${metric} is flat across ${w.label}: baseline ${stats.baseline}${stats.unit}, peak ${stats.peak}${stats.unit} (${stats.change_factor}x), no change point.`;
    return ok(headline, { ...stats, next });
  },
});

// ---------------------------------------------------------------------------
// 3. filter_traces
// ---------------------------------------------------------------------------

const filterTraces = defineTool({
  name: 'filter_traces',
  title: 'Filter distributed traces',
  readOnly: true,
  untrustedContent: true,
  description:
    'Fetch exemplar distributed traces for one service and, more usefully, an aggregate of where those traces spend ' +
    'their time. Returns the matched count, slowest and median duration, how many matched traces errored, a ' +
    'span_breakdown ranked by total time (each entry has total_ms, avg_ms, pct_of_time and how many traces contained ' +
    'that span), and up to `limit` of the slowest individual traces with their full span lists. ' +
    'The span_breakdown is what identifies a bottleneck: when one span holds most of the time, that span — not the ' +
    'endpoint — is the problem, and its name usually names the resource that is contended. ' +
    'Side effect: filters the trace table on screen and opens the slowest matching trace.',
  inputSchema: {
    type: 'object',
    properties: {
      service: serviceProp,
      window: windowProp,
      min_latency_ms: {
        type: 'number',
        description:
          'Only return traces at least this slow, in milliseconds. Omit or use 0 to see everything. Start at 0 or ' +
          '500 and raise it; starting too high returns nothing and tells you less than a wide sweep would.',
      },
      limit: {
        type: 'number',
        description: 'How many individual traces to return, 1-10. Defaults to 5. The aggregate always covers every match, not just these.',
      },
    },
    required: ['service'],
    additionalProperties: false,
  },
  summarize: (a) => `${a.service} traces >= ${a.min_latency_ms ?? 0}ms over ${a.window ?? 'full_incident'}`,
  run: (a) => {
    const service = readService(a.service, 'service', true)!;
    const w = readWindow(a.window);
    const minLatency = readInt(a.min_latency_ms, 'min_latency_ms', 0, 120_000, 0);
    const limit = readInt(a.limit, 'limit', 1, 10, 5);

    const matched = matchTraces(service, w, minLatency);
    if (matched.length === 0) {
      const ceiling = traceLatencyCeiling(service, w);
      const anywhere = TRACES.filter((t) => t.service === service).length;
      const s = state();
      s.setService(service, 'agent');
      s.setWindow(w, 'agent');
      s.setTraceFilter({ minLatencyMs: minLatency, limit }, 'agent');
      return fail(
        ceiling > 0
          ? `No traces for ${service} at or above ${minLatency}ms in ${w.label}. The slowest trace in that window is ${ceiling}ms — lower min_latency_ms to ${Math.floor(ceiling * 0.8)} or below to see it.`
          : `No traces at all for ${service} in ${w.label}. ${anywhere} traces exist for this service across the incident — widen the window (try "full_incident") or check the service name.`,
      );
    }

    const s = state();
    s.setService(service, 'agent');
    s.setWindow(w, 'agent');
    s.setTraceFilter({ minLatencyMs: minLatency, limit }, 'agent');
    s.selectTrace(matched[0].id, 'agent');

    const analysis = analyzeTraces(service, w, minLatency, limit);
    const top = analysis.span_breakdown[0];
    const next = analysis.dominant_span
      ? `"${analysis.dominant_span}" holds ${top.pct_of_time}% of the time, so that is the bottleneck, not the endpoint. Pin it with pin_finding, then find what changed: search_logs for the subsystem it names, and correlate_with_deploys for what shipped before the onset.`
      : 'No single span dominates, so this is not one contended resource. Widen the window or raise min_latency_ms to isolate the slow population.';
    return ok(
      `${analysis.matched} traces for ${service} in ${w.label}; slowest ${analysis.slowest_ms}ms, median ${analysis.median_ms}ms. ` +
        `Time is dominated by "${top.span}" at ${top.pct_of_time}% (avg ${top.avg_ms}ms per trace).`,
      { ...analysis, next },
    );
  },
});

// ---------------------------------------------------------------------------
// 4. search_logs
// ---------------------------------------------------------------------------

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

const searchLogsTool = defineTool({
  name: 'search_logs',
  title: 'Search the log stream',
  readOnly: true,
  untrustedContent: true,
  description:
    'Search one service\'s log stream in a time window and get back grouped patterns rather than raw lines. Digits and ' +
    'hex ids are collapsed so repeated messages count as one pattern; each pattern reports its level, occurrence ' +
    'count, first_seen, last_seen and one verbatim example. Also returns totals per level and the three most recent ' +
    'matching lines. ' +
    'first_seen on a high-count error pattern is frequently the most precise onset time available, more precise than ' +
    'a metric change point, and the text of the pattern often names the subsystem at fault. ' +
    '`query` is a case-insensitive substring match, not a regex. ' +
    'Side effect: filters the log pane on screen.',
  inputSchema: {
    type: 'object',
    properties: {
      service: serviceProp,
      window: windowProp,
      query: {
        type: 'string',
        description:
          'Case-insensitive substring to match anywhere in the message, e.g. "timeout" or "pool". Omit to see ' +
          'everything for the service. Prefer one short word: long phrases rarely match log text exactly.',
      },
      level: {
        type: 'string',
        enum: LEVELS,
        description: 'Only return lines at this level. Omit to search every level. Start without a level, then narrow to "error".',
      },
      limit: {
        type: 'number',
        description: 'How many distinct patterns to return, 1-20. Defaults to 8. Patterns are ordered by severity, then by count.',
      },
    },
    required: ['service'],
    additionalProperties: false,
  },
  summarize: (a) => `${a.service} logs${a.query ? ` matching "${a.query}"` : ''}${a.level ? ` at ${a.level}` : ''}`,
  run: (a) => {
    const service = readService(a.service, 'service', true)!;
    const w = readWindow(a.window);
    const level = a.level === undefined || a.level === null || a.level === '' ? undefined : readEnum<LogLevel>(a.level, LEVELS, 'level');
    const query = a.query === undefined || a.query === null ? undefined : String(a.query);
    const limit = readInt(a.limit, 'limit', 1, 20, 8);

    const s = state();
    s.setService(service, 'agent');
    s.setWindow(w, 'agent');
    s.setLogFilter({ query: query ?? '', level: level ?? 'all' }, 'agent');

    const matched = matchLogs(service, w, extraLogs(s), query, level);
    if (matched.length === 0) {
      const levels = logLevelsAvailable(service, w, extraLogs(s));
      const totalInWindow = matchLogs(service, w, extraLogs(s)).length;
      return fail(
        totalInWindow === 0
          ? `No log lines at all for ${service} in ${w.label}. Widen the window — try "full_incident" — or check the service name.`
          : `No ${service} log lines in ${w.label} match${query ? ` query "${query}"` : ''}${level ? ` at level "${level}"` : ''}. ` +
              `That window has ${totalInWindow} lines at level(s) ${levels.join(', ')}. Drop the level filter or try a shorter query such as "${(query ?? 'error').slice(0, 4)}".`,
      );
    }

    const result = searchLogs(service, w, extraLogs(s), limit, query, level);
    const top = result.patterns[0];
    const next =
      `Pin the pattern and its first_seen (${top.first_seen}) with pin_finding — quote the log text as evidence so the engineer can check it. ` +
      `Then call correlate_with_deploys to find what shipped shortly before ${top.first_seen}.`;
    return ok(
      `${result.matched} matching lines for ${service} in ${w.label}. Top pattern (${top.level}, ${top.count}x, first seen ${top.first_seen}): ${top.example}`,
      { ...result, next },
    );
  },
});

// ---------------------------------------------------------------------------
// 5. correlate_with_deploys
// ---------------------------------------------------------------------------

const correlateWithDeploys = defineTool({
  name: 'correlate_with_deploys',
  title: 'Correlate deploys with the anomaly',
  readOnly: true,
  description:
    'List the deploys that could plausibly explain an anomaly in this window and score each one. The tool first ' +
    'locates the anomaly (the service and minute where a metric changed most sharply, or the service you name), then ' +
    'scores every candidate deploy from 0 to 1 on proximity in time, whether it shipped before rather than after the ' +
    'onset, and whether it touched the same service. Each deploy comes back with its version, author, change list and ' +
    'diff_note. Read the diff_note: it is the annotation the deploying engineer wrote and it frequently contains the ' +
    'actual defect. ' +
    'Deploys from up to 45 minutes before the window are included and flagged in_window: false, because the deploy ' +
    'that broke something usually shipped before the window you are staring at. ' +
    'Side effect: drops deploy markers on the on-screen chart.',
  inputSchema: {
    type: 'object',
    properties: {
      window: windowProp,
      service: {
        type: 'string',
        enum: SERVICE_IDS,
        description:
          'Optional. Score relative to this service\'s anomaly. Omit to let the tool pick the service whose metrics ' +
          'moved most in the window, which is usually what you want.',
      },
    },
    additionalProperties: false,
  },
  summarize: (a) => `deploys near ${a.window ?? 'full_incident'}${a.service ? ` for ${a.service}` : ''}`,
  run: (a) => {
    const w = readWindow(a.window);
    const service = readService(a.service, 'service', false);
    const s = state();

    const result = correlateDeploys(w, rolledBackDeployIds(s), service);
    if (result.deploys.length === 0) {
      return fail(
        `No deploys landed between ${clock(new Date(Date.parse(w.startIso) - 45 * 60_000).toISOString())} and ${clock(w.endIso)}. ` +
          `The incident has ${DEPLOYS.length} deploys in total, the earliest at ${clock(DEPLOYS[0].at)}. Widen the window.`,
      );
    }

    s.setWindow(w, 'agent');
    s.markDeploys(result.deploys.map((d) => d.deploy_id), 'agent');

    const best = result.deploys[0];
    const next =
      best.proximity_score >= 0.5
        ? `Read ${best.deploy_id}'s diff_note before concluding — the defect is usually written in it. If it explains the anomaly, you are done investigating and should now do two things: pin the causal finding with pin_finding at severity "critical", and call propose_rollback with ${best.deploy_id}. Neither happens by itself, and describing the fix in conversation does not put it in front of the engineer. propose_rollback is safe to call: it only asks, and they decide.`
        : 'No deploy scores highly enough to be a confident cause. Widen the window, or pin what you have ruled out with pin_finding so the engineer does not retrace it.';
    return ok(
      result.anomaly_start
        ? `Anomaly on ${result.anomaly_service} (${result.anomaly_metric}) starts ${result.anomaly_start}. Best match: ${best.deploy_id} — ${best.service} ${best.version} at ${best.deployed_at}, ${best.minutes_before_anomaly} min before onset, score ${best.proximity_score}.`
        : `No change point detected in ${w.label}, so deploys are listed without proximity scoring.`,
      { ...result, next },
    );
  },
});

// ---------------------------------------------------------------------------
// 6. pin_finding
// ---------------------------------------------------------------------------

const SEVERITIES = ['info', 'warning', 'critical'] as const;

const pinFinding = defineTool({
  name: 'pin_finding',
  title: 'Pin a finding to the timeline',
  readOnly: false,
  description:
    'Pin one conclusion to the shared incident timeline in the right-hand pane. This is the only way anything you ' +
    'work out reaches the on-call engineer: they are looking at the console, not at this conversation, so a ' +
    'conclusion you only state in your reply is a conclusion they never receive. ' +
    'Pin as you go — one finding per piece of evidence, at the moment you establish it — rather than saving ' +
    'everything for a summary at the end. A four-line answer at the end of a long investigation is worth less to ' +
    'them than four findings pinned against the timestamps they belong to. ' +
    'Write `evidence` so that a human who did not watch you work can verify the claim themselves — include the ' +
    'numbers, span names or log text you actually saw. ' +
    'Findings pinned at severity "critical" are the ones draft_incident_report treats as the stated root cause, so ' +
    'reserve that level for the causal claim rather than for anything alarming.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'One line, under ~80 characters, stating the conclusion. e.g. "checkout p99 up 19x while p50 is flat".',
      },
      evidence: {
        type: 'string',
        description:
          'The specific observation behind the title, with real values: metric numbers, span names and percentages, ' +
          'log text, deploy ids. A human should be able to re-derive the claim from this sentence alone.',
      },
      timestamp: {
        type: 'string',
        description:
          'The clock time on the incident day that the finding is about, as "HH:MM" (e.g. "14:20"). A full ISO ' +
          'timestamp is also accepted. This orders the timeline, so use the time of the evidence, not the time now.',
      },
      severity: {
        type: 'string',
        enum: SEVERITIES,
        description:
          '"info" for context, "warning" for a contributing factor or a ruled-out lead worth recording, "critical" ' +
          'for the causal finding.',
      },
    },
    required: ['title', 'evidence', 'timestamp', 'severity'],
    additionalProperties: false,
  },
  summarize: (a) => String(a.title ?? ''),
  run: (a) => {
    const title = String(a.title ?? '').trim();
    if (!title) throw new ToolError('Missing "title". Give a one-line statement of the conclusion, e.g. "checkout p99 up 19x while p50 is flat".');
    const evidence = String(a.evidence ?? '').trim();
    if (!evidence) {
      throw new ToolError(
        'Missing "evidence". A finding without evidence is not checkable — include the numbers, span names or log text you saw.',
      );
    }
    const timestamp = readClock(a.timestamp, 'timestamp');
    const severity = readEnum<Severity>(a.severity, SEVERITIES, 'severity');

    const s = state();
    const finding = s.addFinding({ title, evidence, timestamp, severity, pinnedBy: 'agent' });
    const all = state().findings;
    return ok(`Pinned "${title}" at ${timestamp} [${severity}]. ${all.length} finding(s) on the timeline.`, {
      pinned: true,
      finding_id: finding.id,
      total_findings: all.length,
      critical_findings: all.filter((f) => f.severity === 'critical').length,
      next: 'Pin the rest of your evidence, then call draft_incident_report.',
    });
  },
});

// ---------------------------------------------------------------------------
// 7. propose_rollback  — the human approval gate
// ---------------------------------------------------------------------------

const proposeRollback = defineTool({
  name: 'propose_rollback',
  title: 'Propose a rollback for human approval',
  readOnly: false,
  description:
    'Propose rolling back a deploy. THIS DOES NOT ROLL ANYTHING BACK. It renders a confirmation card in the console ' +
    'with your reason and returns status "awaiting_human_approval". The rollback happens only if the on-call ' +
    'engineer clicks Approve, and nothing about the system changes until they do — so call this as soon as you have ' +
    'a credible candidate rather than waiting until you are certain. The human is the check, not you. ' +
    'Call it rather than describing it. Recommending a rollback in your reply puts nothing on their screen; only ' +
    'this tool renders the card they can act on. You do not need to ask their permission to ask them — that is ' +
    'what the card is for. ' +
    'Write `reason` for the person about to take production action at 3am: name the deploy, the evidence that ' +
    'implicates it, and what you expect the rollback to fix. ' +
    'After calling this, stop and wait. Poll get_current_view to see what they decided.',
  inputSchema: {
    type: 'object',
    properties: {
      deploy_id: {
        type: 'string',
        enum: DEPLOYS.map((d) => d.id),
        description: 'The deploy to roll back. Get these ids from correlate_with_deploys.',
      },
      reason: {
        type: 'string',
        description:
          'Why this deploy, in one or two sentences a tired human can act on. Cite the evidence and say what you ' +
          'expect rolling back to fix.',
      },
    },
    required: ['deploy_id', 'reason'],
    additionalProperties: false,
  },
  summarize: (a) => `rollback ${a.deploy_id} (awaiting human)`,
  run: (a) => {
    const deployId = String(a.deploy_id ?? '').trim();
    const deploy = deployById(deployId);
    if (!deploy) {
      throw new ToolError(
        `"${deployId}" is not a known deploy. Valid deploy ids: ${DEPLOYS.map((d) => `${d.id} (${d.service} ${d.version} at ${clock(d.at)})`).join(', ')}. Call correlate_with_deploys to see which one matters.`,
      );
    }
    const reason = String(a.reason ?? '').trim();
    if (reason.length < 12) {
      throw new ToolError(
        'Missing or too-short "reason". A human is about to take production action on your word — give them the ' +
          'evidence that implicates this deploy and what you expect the rollback to fix.',
      );
    }

    const s = state();
    if (s.appliedRollback?.deployId === deployId && s.appliedRollback.decision === 'approved') {
      return fail(`${deployId} has already been rolled back (approved by the on-call engineer). Verify recovery with query_metrics instead.`);
    }
    if (s.pendingRollback) {
      return fail(
        `A rollback of ${s.pendingRollback.deployId} is already on screen awaiting human approval. Wait for that decision — call get_current_view to check — before proposing another.`,
      );
    }

    // The safety gate. This writes a *proposal* and nothing else. No service
    // state, no metric, no alert changes here. The only code path that applies
    // a rollback is store.approveRollback(), and the only caller of that is the
    // Approve button's onClick handler in RollbackCard.tsx. An agent cannot
    // reach it: it is not exposed as a tool, and it is not called from here.
    const pending = s.proposeRollback({
      deployId,
      service: deploy.service,
      version: deploy.version,
      reason,
    });

    return ok(
      `Rollback of ${deployId} (${deploy.service} ${deploy.version}) is on screen awaiting human approval. Nothing has changed yet.`,
      {
        status: pending.status,
        deploy_id: deployId,
        service: deploy.service,
        version: deploy.version,
        applied: false,
        note: 'The on-call engineer must click Approve in the console. Poll get_current_view for their decision.',
      },
    );
  },
});

// ---------------------------------------------------------------------------
// 8. draft_incident_report
// ---------------------------------------------------------------------------

const draftIncidentReport = defineTool({
  name: 'draft_incident_report',
  title: 'Draft the incident report',
  readOnly: false,
  description:
    'Assemble the pinned findings into a structured postmortem in the right-hand pane: a summary, computed impact ' +
    '(minutes over the latency SLO and an estimated failed-request count derived from traffic rates), a merged ' +
    'timeline of deploys, alerts and findings, the findings themselves with attribution to whoever pinned them, a ' +
    'root cause section built from the findings pinned at critical severity, and follow-up actions. ' +
    'Fails if nothing has been pinned yet — the report is assembled from findings, not invented. Call pin_finding for ' +
    'each conclusion first. Once a rollback has been approved, call this again: the report picks up the mitigation ' +
    'and the recovery.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => 'assembled postmortem',
  run: () => {
    const s = state();
    if (s.findings.length === 0) {
      return fail(
        'Nothing to report: no findings are pinned. The report is assembled from pinned findings, so call ' +
          'pin_finding for each conclusion you have reached (at minimum the causal one, at severity "critical") and ' +
          'then call draft_incident_report again.',
      );
    }

    const report = buildReport(s.findings, {
      nowIso: nowIso(s),
      resolvedAlertIds: resolvedAlertIds(s),
      appliedRollback: s.appliedRollback,
    });
    s.setReport(report);

    return ok(
      `Drafted ${report.incidentId} postmortem from ${report.findingCount} finding(s); ${report.sections.length} sections now in the right-hand pane.`,
      {
        incident_id: report.incidentId,
        sections: report.sections.map((sec) => ({ heading: sec.heading, lines: sec.body.length })),
        finding_count: report.findingCount,
        critical_findings: s.findings.filter((f) => f.severity === 'critical').length,
      },
    );
  },
});

// ---------------------------------------------------------------------------
// 9. get_current_view  — the handoff tool
// ---------------------------------------------------------------------------

const getCurrentView = defineTool({
  name: 'get_current_view',
  title: 'Read what the human is looking at',
  readOnly: true,
  description:
    'Read what the on-call engineer is currently looking at, so you can continue their investigation instead of ' +
    'restarting it. Returns the service and metric selected on their screen, the time window on their chart, the ' +
    'trace they have open with its span breakdown, the trace and log filters in effect, every finding pinned so far ' +
    'and by whom, whether a rollback is awaiting their approval or has already been decided, and their most recent ' +
    'manual actions. ' +
    'Call this first in any session, and again whenever you are about to ask the human for context — they have often ' +
    'already dragged the window to the interesting range or opened the trace that answers your question. Also call it ' +
    'after propose_rollback to see whether they approved. ' +
    'Side effect: flashes a handoff indicator in the console header so the human knows you have picked up their view.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => 'read the human view',
  run: () => {
    const s = state();
    s.touch('handoff', 'agent', 'read the human view');

    const openTrace = s.selectedTraceId ? TRACES.find((t) => t.id === s.selectedTraceId) : undefined;
    const humanActions = s.activity
      .filter((e) => e.actor === 'human')
      .slice(0, 5)
      .map((e) => `${e.label}: ${e.detail}`);

    const view = {
      incident: { id: INCIDENT.id, title: INCIDENT.title, as_of: clock(nowIso(s)) },
      looking_at: {
        service: s.selectedService,
        metric: s.metric,
        window: s.window.label,
        window_iso: `${s.window.startIso}/${s.window.endIso}`,
      },
      open_trace: openTrace
        ? {
            id: openTrace.id,
            t: clock(openTrace.t),
            duration_ms: openTrace.durationMs,
            status: openTrace.status,
            spans: openTrace.spans.map((sp) => ({ name: sp.name, duration_ms: sp.durationMs })),
          }
        : null,
      filters: {
        trace_min_latency_ms: s.traceMinLatencyMs,
        log_query: s.logQuery || null,
        log_level: s.logLevel,
        deploy_markers: s.markedDeployIds,
      },
      pinned_findings: s.findings.map((f) => ({
        id: f.id,
        title: f.title,
        evidence: f.evidence,
        timestamp: f.timestamp,
        severity: f.severity,
        pinned_by: f.pinnedBy,
      })),
      rollback: s.pendingRollback
        ? { state: 'awaiting_human_approval', deploy_id: s.pendingRollback.deployId, reason: s.pendingRollback.reason }
        : s.appliedRollback
          ? {
              state: s.appliedRollback.decision === 'approved' ? 'approved_and_applied' : 'dismissed_by_human',
              deploy_id: s.appliedRollback.deployId,
              decided_at: clock(nowIso(s)),
            }
          : { state: 'none_proposed' },
      report_drafted: s.report !== null,
      recent_human_actions: humanActions.length ? humanActions : ['none yet — the human has not touched the console'],
    };

    const headline =
      `The on-call engineer is looking at ${s.selectedService} ${s.metric} over ${s.window.label}` +
      (openTrace ? `, with trace ${openTrace.id} (${openTrace.durationMs}ms) open` : '') +
      `. ${s.findings.length} finding(s) pinned. Rollback: ${view.rollback.state}.`;
    return ok(headline, view);
  },
});

// ---------------------------------------------------------------------------

export const TOOLS: ToolDefinition[] = [
  getServiceHealth,
  queryMetrics,
  filterTraces,
  searchLogsTool,
  correlateWithDeploys,
  pinFinding,
  proposeRollback,
  draftIncidentReport,
  getCurrentView,
];

/** Used by the in-page tool console so a human can exercise a tool by hand. */
export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export const DEMO_NOW = isoAtMinute(LIVE_MINUTES);
