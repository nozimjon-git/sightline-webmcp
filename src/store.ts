/**
 * One store. The buttons and the WebMCP tools call the same actions.
 *
 * This is the architectural point of the submission: there is no "agent code
 * path". `filter_traces` calls `setTraceFilter`, and so does the slider in the
 * trace pane header. Anything an agent can do, a human can do, and both are
 * immediately visible to the other.
 *
 * Every mutating action takes an `Actor` so the UI can show who did what, and
 * pulses the pane it touched so a tool call is never invisible.
 */

import { create } from 'zustand';
import {
  INCIDENT,
  LIVE_MINUTES,
  ROLLBACK_LOGS,
  ROLLBACK_MINUTE,
  TOTAL_MINUTES,
  isoAtMinute,
  type LogLevel,
  type LogLine,
  type MetricName,
  type ServiceId,
} from './data/incident';
import { parseWindow, type TimeWindow } from './lib/time';

export type Actor = 'agent' | 'human';

export type PaneId = 'services' | 'chart' | 'traces' | 'logs' | 'timeline' | 'rollback' | 'report' | 'handoff';

export type Severity = 'info' | 'warning' | 'critical';

export interface Finding {
  id: string;
  title: string;
  evidence: string;
  /** Clock time this finding is about, e.g. "14:20". */
  timestamp: string;
  severity: Severity;
  pinnedBy: Actor;
  pinnedAt: string;
}

export interface PendingRollback {
  deployId: string;
  service: ServiceId;
  version: string;
  reason: string;
  proposedAt: string;
  status: 'awaiting_human_approval';
}

export interface AppliedRollback {
  deployId: string;
  service: ServiceId;
  version: string;
  reason: string;
  decidedAt: string;
  decision: 'approved' | 'rejected';
}

export interface ReportSection {
  heading: string;
  body: string[];
}

export interface IncidentReport {
  incidentId: string;
  title: string;
  generatedAt: string;
  sections: ReportSection[];
  findingCount: number;
}

export interface ActivityEntry {
  id: number;
  actor: Actor;
  /** Tool name for agent entries, a short verb phrase for human ones. */
  label: string;
  detail: string;
  at: number;
  ok: boolean;
}

/** Who last changed a pane, and how. Rendered in every pane header. */
export interface Provenance {
  actor: Actor;
  label: string;
  at: number;
}

export interface McpStatus {
  state: 'checking' | 'connected' | 'unavailable' | 'error';
  api: string;
  toolCount: number;
  message?: string;
}

const LIVE_NOW = isoAtMinute(LIVE_MINUTES);
const POST_ROLLBACK_NOW = isoAtMinute(TOTAL_MINUTES);

/** Alerts that a successful rollback of dep-1104 clears. */
const ROLLBACK_RESOLVES = ['alr-8801', 'alr-8802', 'alr-8803', 'alr-8804'];

export interface AppState {
  // --- shared view state, read by get_current_view ---
  selectedService: ServiceId;
  metric: MetricName;
  window: TimeWindow;
  selectedTraceId: string | null;
  traceMinLatencyMs: number;
  traceLimit: number;
  logQuery: string;
  logLevel: LogLevel | 'all';
  markedDeployIds: string[];

  // --- durable incident state ---
  findings: Finding[];
  pendingRollback: PendingRollback | null;
  appliedRollback: AppliedRollback | null;
  report: IncidentReport | null;

  // --- presentation ---
  activity: ActivityEntry[];
  pulses: Record<PaneId, number>;
  provenance: Partial<Record<PaneId, Provenance>>;
  mcp: McpStatus;

  // --- actions (shared by UI and tools) ---
  setService: (service: ServiceId, by: Actor) => void;
  setMetric: (metric: MetricName, by: Actor) => void;
  setWindow: (window: TimeWindow, by: Actor) => void;
  selectTrace: (traceId: string | null, by: Actor) => void;
  setTraceFilter: (filter: { minLatencyMs?: number; limit?: number }, by: Actor) => void;
  setLogFilter: (filter: { query?: string; level?: LogLevel | 'all' }, by: Actor) => void;
  markDeploys: (deployIds: string[], by: Actor) => void;
  addFinding: (finding: Omit<Finding, 'id' | 'pinnedAt'>) => Finding;
  removeFinding: (id: string) => void;
  proposeRollback: (proposal: Omit<PendingRollback, 'proposedAt' | 'status'>) => PendingRollback;
  /** Human-only. Called from the Approve button's onClick and nowhere else. */
  approveRollback: () => void;
  /** Human-only. Called from the Dismiss button's onClick and nowhere else. */
  rejectRollback: () => void;
  setReport: (report: IncidentReport) => void;
  logActivity: (entry: Omit<ActivityEntry, 'id' | 'at'>) => void;
  /** Record who changed a pane and flash it. The one motion idea in the app. */
  touch: (pane: PaneId, by: Actor, label: string) => void;
  setMcp: (mcp: McpStatus) => void;
}

let activitySeq = 0;
let findingSeq = 0;

/**
 * Set by the tool wrapper for the duration of one execute() call, so a pane's
 * provenance stamp can name the tool that changed it rather than just "agent".
 */
let currentToolName: string | null = null;
export const withToolName = <T,>(name: string, fn: () => T): T => {
  currentToolName = name;
  try {
    return fn();
  } finally {
    currentToolName = null;
  }
};
const agentLabel = (by: Actor, label: string) => (by === 'agent' && currentToolName ? currentToolName : label);

const emptyPulses: Record<PaneId, number> = {
  services: 0,
  chart: 0,
  traces: 0,
  logs: 0,
  timeline: 0,
  rollback: 0,
  report: 0,
  handoff: 0,
};

export const useStore = create<AppState>((set, get) => ({
  selectedService: 'checkout-service',
  metric: 'p99',
  window: parseWindow('full_incident', LIVE_NOW),
  selectedTraceId: null,
  traceMinLatencyMs: 0,
  traceLimit: 8,
  logQuery: '',
  logLevel: 'all',
  markedDeployIds: [],

  findings: [],
  pendingRollback: null,
  appliedRollback: null,
  report: null,

  activity: [],
  pulses: { ...emptyPulses },
  provenance: {},
  mcp: { state: 'checking', api: '', toolCount: 0 },

  touch: (pane, by, label) =>
    set((s) => ({
      pulses: { ...s.pulses, [pane]: s.pulses[pane] + 1 },
      provenance: { ...s.provenance, [pane]: { actor: by, label: agentLabel(by, label), at: Date.now() } },
    })),

  logActivity: (entry) =>
    set((s) => ({ activity: [{ ...entry, id: ++activitySeq, at: Date.now() }, ...s.activity].slice(0, 60) })),

  setService: (service, by) => {
    // Only drop the open trace when the service actually changes: a tool that
    // re-selects the same service should not close what the human is reading.
    const changed = get().selectedService !== service;
    set({ selectedService: service, selectedTraceId: changed ? null : get().selectedTraceId });
    get().touch('chart', by, `service ${service}`);
    get().touch('services', by, `service ${service}`);
    if (by === 'human') get().logActivity({ actor: 'human', label: 'selected service', detail: service, ok: true });
  },

  setMetric: (metric, by) => {
    set({ metric });
    get().touch('chart', by, `metric ${metric}`);
    if (by === 'human') get().logActivity({ actor: 'human', label: 'switched metric', detail: metric, ok: true });
  },

  setWindow: (window, by) => {
    set({ window });
    get().touch('chart', by, `window ${window.label}`);
    if (by === 'human') get().logActivity({ actor: 'human', label: 'set time window', detail: window.label, ok: true });
  },

  selectTrace: (traceId, by) => {
    set({ selectedTraceId: traceId });
    get().touch('traces', by, traceId ? `trace ${traceId.slice(3, 9)}` : 'cleared trace');
    if (by === 'human' && traceId) {
      get().logActivity({ actor: 'human', label: 'opened trace', detail: traceId, ok: true });
    }
  },

  setTraceFilter: (filter, by) => {
    set((s) => ({
      traceMinLatencyMs: filter.minLatencyMs ?? s.traceMinLatencyMs,
      traceLimit: filter.limit ?? s.traceLimit,
    }));
    get().touch('traces', by, `traces >= ${get().traceMinLatencyMs}ms`);
    if (by === 'human') {
      get().logActivity({
        actor: 'human',
        label: 'filtered traces',
        detail: `min ${get().traceMinLatencyMs}ms`,
        ok: true,
      });
    }
  },

  setLogFilter: (filter, by) => {
    set((s) => ({ logQuery: filter.query ?? s.logQuery, logLevel: filter.level ?? s.logLevel }));
    get().touch('logs', by, get().logQuery ? `query "${get().logQuery}"` : 'all lines');
    if (by === 'human') {
      get().logActivity({ actor: 'human', label: 'searched logs', detail: get().logQuery || '(cleared)', ok: true });
    }
  },

  markDeploys: (deployIds, by) => {
    set({ markedDeployIds: deployIds });
    get().touch('chart', by, `${deployIds.length} deploy marker(s)`);
    if (by === 'human') {
      get().logActivity({ actor: 'human', label: 'marked deploys', detail: deployIds.join(', '), ok: true });
    }
  },

  addFinding: (finding) => {
    const full: Finding = { ...finding, id: `f-${++findingSeq}`, pinnedAt: new Date().toISOString() };
    set((s) => ({ findings: [...s.findings, full] }));
    get().touch('timeline', finding.pinnedBy, `pinned "${finding.title.slice(0, 34)}"`);
    if (finding.pinnedBy === 'human') {
      get().logActivity({ actor: 'human', label: 'pinned finding', detail: finding.title, ok: true });
    }
    return full;
  },

  removeFinding: (id) => {
    const removed = get().findings.find((f) => f.id === id);
    set((s) => ({ findings: s.findings.filter((f) => f.id !== id) }));
    get().touch('timeline', 'human', 'removed a finding');
    if (removed) get().logActivity({ actor: 'human', label: 'removed finding', detail: removed.title, ok: true });
  },

  proposeRollback: (proposal) => {
    const pending: PendingRollback = { ...proposal, proposedAt: new Date().toISOString(), status: 'awaiting_human_approval' };
    // Note what is NOT happening here: no state that describes the *system*
    // changes. The proposal is a request for a human decision, nothing more.
    set({ pendingRollback: pending });
    get().touch('rollback', 'agent', `proposed ${proposal.deployId}`);
    return pending;
  },

  approveRollback: () => {
    const pending = get().pendingRollback;
    if (!pending) return;
    set({
      pendingRollback: null,
      appliedRollback: { ...pending, decidedAt: new Date().toISOString(), decision: 'approved' },
      // Widen the window so the post-rollback telemetry the approval unlocked
      // is actually on screen rather than just off the right edge.
      window: parseWindow('full_incident', POST_ROLLBACK_NOW),
    });
    get().addFinding({
      title: `Rolled back ${pending.service} ${pending.version}`,
      evidence: `Human approved rollback of ${pending.deployId}. Post-rollback telemetry (15:00-15:20) is now on the chart.`,
      timestamp: '15:03',
      severity: 'info',
      pinnedBy: 'human',
    });
    get().logActivity({
      actor: 'human',
      label: 'APPROVED rollback',
      detail: `${pending.deployId} — ${pending.service} ${pending.version}`,
      ok: true,
    });
    get().touch('rollback', 'human', `approved ${pending.deployId}`);
    get().touch('chart', 'human', 'post-rollback data');
    get().touch('services', 'human', 'alerts cleared');
  },

  rejectRollback: () => {
    const pending = get().pendingRollback;
    if (!pending) return;
    set({
      pendingRollback: null,
      appliedRollback: { ...pending, decidedAt: new Date().toISOString(), decision: 'rejected' },
    });
    get().logActivity({ actor: 'human', label: 'DISMISSED rollback', detail: pending.deployId, ok: true });
    get().touch('rollback', 'human', `dismissed ${pending.deployId}`);
  },

  setReport: (report) => {
    set({ report });
    get().touch('report', 'agent', `${report.findingCount} findings`);
  },

  setMcp: (mcp) => set({ mcp }),
}));

// ---------------------------------------------------------------------------
// Derived state. A rollback moves the world forward; these three selectors are
// how that shows up everywhere else.
// ---------------------------------------------------------------------------

const rollbackSucceeded = (s: AppState): boolean => s.appliedRollback?.decision === 'approved';

// These are used as Zustand selectors, so every branch must return a *stable*
// reference. Returning a fresh `[]` re-renders forever.
const NO_ALERT_IDS: string[] = [];
const NO_LOGS: LogLine[] = [];
const NO_DEPLOY_IDS: string[] = [];
const rolledBackCache = new Map<string, string[]>();

export const nowIso = (s: AppState): string => (rollbackSucceeded(s) ? POST_ROLLBACK_NOW : LIVE_NOW);

export const resolvedAlertIds = (s: AppState): string[] => (rollbackSucceeded(s) ? ROLLBACK_RESOLVES : NO_ALERT_IDS);

export const extraLogs = (s: AppState): LogLine[] => (rollbackSucceeded(s) ? ROLLBACK_LOGS : NO_LOGS);

export const rolledBackDeployIds = (s: AppState): string[] => {
  if (!rollbackSucceeded(s) || !s.appliedRollback) return NO_DEPLOY_IDS;
  const id = s.appliedRollback.deployId;
  if (!rolledBackCache.has(id)) rolledBackCache.set(id, [id]);
  return rolledBackCache.get(id)!;
};

export const mitigationMinute = (s: AppState): number | null => (rollbackSucceeded(s) ? ROLLBACK_MINUTE : null);

export const incidentMeta = INCIDENT;
