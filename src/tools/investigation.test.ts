/**
 * The whole investigation, end to end, through the tool layer.
 *
 * The unit tests next door check one contract each. This one checks the path
 * the submission is actually about: an agent surveys, narrows, correlates,
 * pins, and asks — and a human, and only a human, applies the result. Every
 * step asserts the state the next step depends on, so a regression anywhere
 * along the chain fails here rather than in a demo.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { TOOL_BY_NAME } from './index';

/** Tools answer with a headline plus a JSON payload; tests read the payload. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  const result = await tool.execute(args);
  const text = result.content.map((part) => part.text).join('\n');
  const brace = text.indexOf('\n{');
  return {
    isError: result.isError ?? false,
    text,
    payload: brace === -1 ? null : (JSON.parse(text.slice(brace + 1)) as Record<string, never>),
  };
}

describe('the full investigation', () => {
  beforeEach(() => useStore.getState().resetIncident());

  it('walks survey to postmortem and lands on the real root cause', async () => {
    // 1. Survey. The board is noisy on purpose: one service is critical.
    const health = await call('get_service_health');
    expect(health.isError).toBe(false);
    const services = health.payload!.services as { service: string; status: string }[];
    expect(services).toHaveLength(5);
    expect(services.find((s) => s.service === 'checkout-service')?.status).toBe('critical');

    // 2. The tell: p99 moves an order of magnitude, p50 barely moves. That is
    //    queueing, not compute, and it is the whole discrimination the fixture
    //    is built around.
    const p99 = await call('query_metrics', {
      service: 'checkout-service',
      metric: 'p99',
      window: 'full_incident',
    });
    expect(p99.payload!.anomaly_start).toBe('14:20');
    expect(Number(p99.payload!.change_factor)).toBeGreaterThan(10);

    const p50 = await call('query_metrics', {
      service: 'checkout-service',
      metric: 'p50',
      window: 'full_incident',
    });
    expect(p50.payload!.anomaly_start).toBeNull();
    expect(Number(p50.payload!.change_factor)).toBeLessThan(2);

    // 3. Where the time actually goes.
    const traces = await call('filter_traces', {
      service: 'checkout-service',
      min_latency_ms: 1000,
      limit: 3,
    });
    expect(traces.payload!.dominant_span).toBe('db.connection.acquire');

    // 4. The logs name the pool by name.
    const logs = await call('search_logs', { service: 'checkout-service', query: 'HikariPool' });
    expect(Number(logs.payload!.matched)).toBeGreaterThan(0);

    // 5. Correlation picks the culprit out of three candidate releases.
    const correlation = await call('correlate_with_deploys', { service: 'checkout-service' });
    const deploys = correlation.payload!.deploys as { deploy_id: string; diff_note: string }[];
    expect(deploys[0].deploy_id).toBe('dep-1104');
    expect(deploys[0].diff_note).toContain('maximumPoolSize');

    // 6. Pinning puts the finding in front of the human, not in a reply.
    const pin = await call('pin_finding', {
      title: 'Connection pool starvation in checkout',
      evidence: 'p99 x19.3 while p50 stayed flat; 96.2% of span time in db.connection.acquire.',
      timestamp: '14:20',
      severity: 'critical',
      confidence: 0.96,
      source_refs: ['filter_traces', 'correlate_with_deploys'],
    });
    expect(pin.isError).toBe(false);
    expect(useStore.getState().findings).toHaveLength(1);

    // 7. Proposing asks. It must not act.
    const proposal = await call('propose_rollback', {
      deploy_id: 'dep-1104',
      reason: 'dep-1104 cut hikari maximumPoolSize from 50 to 10 eight minutes before onset.',
    });
    expect(proposal.payload!.status).toBe('awaiting_human_approval');
    expect(useStore.getState().pendingRollback?.deployId).toBe('dep-1104');
    expect(useStore.getState().appliedRollback).toBeNull();

    // 8. Recovery telemetry stays behind the gate until a human opens it.
    const early = await call('query_metrics', {
      service: 'checkout-service',
      metric: 'p99',
      window: '15:05-15:20',
    });
    expect(early.isError).toBe(true);

    // 9. The human decides. This is the only call in the test that is not a tool.
    useStore.getState().approveRollback();
    expect(useStore.getState().appliedRollback?.decision).toBe('approved');

    // 10. The same questions now return the recovery the approval unlocked.
    const recovered = await call('get_service_health');
    const after = recovered.payload!.services as { service: string; status: string }[];
    expect(after.every((s) => s.status === 'healthy')).toBe(true);

    const post = await call('query_metrics', {
      service: 'checkout-service',
      metric: 'p99',
      window: '15:05-15:20',
    });
    expect(post.isError).toBe(false);

    // 11. The postmortem assembles from what was pinned along the way.
    const report = await call('draft_incident_report');
    expect(report.isError).toBe(false);
    const rootCause = useStore
      .getState()
      .report!.sections.find((section) => section.heading === 'Root cause')!;
    expect(rootCause.body.join(' ')).toContain('dep-1104');
  });

  /**
   * The guarantee the entire design rests on. Every tool runs with arguments
   * plausible enough to do damage if any of them could, while a proposal sits
   * pending — and the rollback stays unapplied throughout.
   */
  it('gives no tool a path to applying a rollback', async () => {
    await call('propose_rollback', {
      deploy_id: 'dep-1104',
      reason: 'dep-1104 cut the pool from 50 to 10 and starved checkout of connections.',
    });
    expect(useStore.getState().pendingRollback).not.toBeNull();

    const everyTool: Record<string, Record<string, unknown>> = {
      get_service_health: {},
      query_metrics: { service: 'checkout-service', metric: 'p99', window: 'full_incident' },
      filter_traces: { service: 'checkout-service', min_latency_ms: 500 },
      search_logs: { service: 'checkout-service', query: 'connection' },
      correlate_with_deploys: { service: 'checkout-service' },
      pin_finding: {
        title: 'Approved: rolling back now',
        evidence: 'Deliberately worded as though the tool could apply the rollback itself.',
        timestamp: '14:20',
        severity: 'critical',
      },
      propose_rollback: { deploy_id: 'dep-1104', reason: 'A second proposal while one is pending.' },
      draft_incident_report: {},
      get_current_view: {},
    };

    // Every registered tool is covered; a new tool cannot slip past this test.
    expect(Object.keys(everyTool).sort()).toEqual([...TOOL_BY_NAME.keys()].sort());

    for (const [name, args] of Object.entries(everyTool)) {
      await call(name, args);
      expect(useStore.getState().appliedRollback, `${name} applied a rollback`).toBeNull();
    }

    expect(useStore.getState().appliedRollback).toBeNull();
  });
});
