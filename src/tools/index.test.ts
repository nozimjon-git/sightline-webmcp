import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { TOOL_BY_NAME } from './index';

const call = (name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool.execute(args, { signal });
};

describe('WebMCP tool contracts', () => {
  beforeEach(() => useStore.getState().resetIncident());

  it('keeps the registered surface concise and contract-focused', () => {
    const totalDescriptionCharacters = [...TOOL_BY_NAME.values()].reduce(
      (total, tool) => total + tool.description.length,
      0,
    );
    expect(totalDescriptionCharacters).toBeLessThan(3000);
  });

  it('keeps future recovery telemetry behind the human approval gate', async () => {
    const result = await call('query_metrics', {
      service: 'checkout-service',
      metric: 'p99',
      window: '15:01-15:20',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('after the latest available telemetry');
  });

  it('rejects malformed and oversized inputs with a useful tool error', async () => {
    const badTime = await call('pin_finding', {
      title: 'Clock check',
      evidence: 'The timestamp should be validated.',
      timestamp: '99:99',
      severity: 'info',
    });
    expect(badTime.isError).toBe(true);

    const oversized = await call('search_logs', {
      service: 'checkout-service',
      query: 'x'.repeat(121),
    });
    expect(oversized.isError).toBe(true);
    expect(oversized.content[0].text).toContain('at most 120 characters');
  });

  it('honors cancellation before a tool starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await call('get_service_health', {}, controller.signal);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('cancelled');
  });

  it('keeps an existing report synchronized with an approved rollback', async () => {
    const state = useStore.getState();
    state.addFinding({
      title: 'Connection pool regression caused checkout queueing',
      evidence: 'dep-1104 reduced maximumPoolSize from 50 to 10.',
      timestamp: '14:12',
      severity: 'critical',
      pinnedBy: 'agent',
    });
    await call('draft_incident_report');
    useStore.getState().proposeRollback({
      deployId: 'dep-1104',
      service: 'checkout-service',
      version: 'v2.14',
      reason: 'The deploy reduced the pool from 50 to 10 and caused connection queueing.',
    });
    useStore.getState().approveRollback();

    const report = useStore.getState().report;
    expect(report).not.toBeNull();
    expect(report!.sections.find((section) => section.heading === 'Summary')?.body).toContain(
      'All services are currently healthy.',
    );
    expect(report!.sections.find((section) => section.heading === 'Root cause')?.body.join(' ')).toContain(
      'was rolled back after human approval',
    );
  });

  it('reports the preserved decision timestamp in the shared view', async () => {
    const state = useStore.getState();
    state.proposeRollback({
      deployId: 'dep-1104',
      service: 'checkout-service',
      version: 'v2.14',
      reason: 'The deploy reduced the pool from 50 to 10 and caused connection queueing.',
    });
    state.approveRollback();
    const result = await call('get_current_view');
    expect(result.content[0].text).toContain('"decided_at":"15:03"');
  });
});
