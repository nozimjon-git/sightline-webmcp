/**
 * Dev-only harness: walks the whole investigation through the tool layer with
 * no agent present, so tool contracts and store side effects can be verified
 * from the command line. Not part of the production build (Vite only bundles
 * index.html).
 */
import { TOOL_BY_NAME } from './tools';
import { useStore } from './store';

const lines: string[] = [];
const say = (s: string) => lines.push(s);

async function call(name: string, args: Record<string, unknown> = {}) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  const t0 = performance.now();
  const res = await tool.execute(args);
  const ms = (performance.now() - t0).toFixed(1);
  say(`\n─── ${name}(${JSON.stringify(args)})  ${res.isError ? 'ERROR' : 'ok'} ${ms}ms`);
  say(res.content.map((c) => c.text).join('\n'));
  return res;
}

async function main() {
  say('### schemas');
  for (const t of TOOL_BY_NAME.values()) {
    say(`${t.name}(${Object.keys(t.inputSchema.properties).join(', ') || ''})  required=[${(t.inputSchema.required ?? []).join(',')}]  readOnly=${t.annotations?.readOnlyHint}  desc=${t.description.length}ch`);
  }

  say('\n\n### happy path');
  await call('get_current_view');
  await call('get_service_health');
  await call('query_metrics', { service: 'checkout-service', metric: 'p99', window: 'full_incident' });
  await call('query_metrics', { service: 'checkout-service', metric: 'p50', window: 'full_incident' });
  await call('filter_traces', { service: 'checkout-service', window: '14:20-15:00', min_latency_ms: 1000, limit: 2 });
  await call('search_logs', { service: 'checkout-service', window: '14:15-15:00', query: 'connection' });
  await call('correlate_with_deploys', { window: 'last_60m' });
  await call('pin_finding', {
    title: 'checkout p99 up 19x while p50 is flat',
    evidence: 'p99 183ms -> 3499ms (19.3x) from 14:20; p50 65ms -> 82ms (1.25x, no change point).',
    timestamp: '14:20',
    severity: 'warning',
  });
  await call('pin_finding', {
    title: 'v2.14 shrank the connection pool from 50 to 10',
    evidence: 'dep-1104 diff_note: hikari.maximumPoolSize 50 -> 10. 94.6% of trace time in db.connection.acquire.',
    timestamp: '14:12',
    severity: 'critical',
  });
  await call('propose_rollback', { deploy_id: 'dep-1104', reason: 'v2.14 cut the pool 50->10 eight minutes before onset.' });
  await call('draft_incident_report');
  await call('get_current_view');

  say('\n\n### errors must teach');
  await call('query_metrics', { service: 'checkout', metric: 'p99' });
  await call('query_metrics', { service: 'checkout-service', metric: 'latency' });
  await call('query_metrics', { service: 'checkout-service', metric: 'p99', window: 'yesterday' });
  await call('filter_traces', { service: 'checkout-service', window: '13:30-14:00', min_latency_ms: 3000 });
  await call('filter_traces', { service: 'user-service', window: '14:20-14:25', min_latency_ms: 0 });
  await call('search_logs', { service: 'payment-gateway', window: '13:30-13:40', query: 'hikari' });
  await call('propose_rollback', { deploy_id: 'dep-9999', reason: 'a plausible sounding reason here' });
  await call('propose_rollback', { deploy_id: 'dep-1091', reason: 'second proposal while one is pending' });
  await call('pin_finding', { title: 'no evidence', evidence: '', timestamp: '14:20', severity: 'critical' });
  await call('pin_finding', { title: 'bad time', evidence: 'x', timestamp: 'about half two', severity: 'info' });

  say('\n\n### human approves the rollback (the only path that applies it)');
  useStore.getState().approveRollback();
  await call('get_service_health');
  await call('query_metrics', { service: 'checkout-service', metric: 'p99', window: '14:50-15:20' });
  await call('search_logs', { service: 'checkout-service', window: '15:00-15:20' });
  await call('draft_incident_report');
  await call('get_current_view');

  say('\n\n### empty report guard (fresh store)');
  useStore.setState({ findings: [], report: null });
  await call('draft_incident_report');

  say(`\n\nDONE. payload sizes: ${lines.join('').length} chars total transcript.`);
}

main()
  .catch((e) => say(`FATAL ${e?.stack ?? e}`))
  .finally(() => {
    document.getElementById('out')!.textContent = lines.join('\n');
  });
