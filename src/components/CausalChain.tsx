/**
 * The rollback argument, as a chain rather than a paragraph.
 *
 * An on-call engineer deciding whether to ship a rollback needs to see the
 * inference, not a summary of it: this deploy changed this line, which moved
 * this share of trace time, which moved this percentile. Each link is computed
 * from the same fixture the tools read, and each one scrolls to the evidence it
 * was derived from — the chain is a table of contents for the investigation,
 * not a restatement of its conclusion.
 */

import { CaretDown } from '@phosphor-icons/react';
import { METRIC_UNITS, clock, type Deploy } from '../data/incident';
import { analyzeTraces, metricStats } from '../lib/analysis';
import { useStore } from '../store';

/** Pull the first changed key out of a unified diff: `maximumPoolSize 50 → 10`. */
export function changedSetting(diff: string[]): { key: string; from: string; to: string } | null {
  const parse = (line: string) => {
    const match = /^[+-]\s*([\w.-]+):\s*(.+?)\s*$/.exec(line);
    return match ? { key: match[1], value: match[2] } : null;
  };
  const removed = diff.filter((l) => /^-[^-]/.test(l)).map(parse);
  const added = diff.filter((l) => /^\+[^+]/.test(l)).map(parse);
  for (const before of removed) {
    if (!before) continue;
    const after = added.find((entry) => entry?.key === before.key);
    if (after) return { key: before.key, from: before.value, to: after.value };
  }
  return null;
}

/** Scroll a pane into view and outline it briefly, so the jump is legible. */
function revealEvidence(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  target.classList.add('evidence-focus');
  window.setTimeout(() => target.classList.remove('evidence-focus'), 1400);
}

interface Link {
  at: string;
  claim: string;
  target: string;
  targetLabel: string;
}

export function CausalChain({ deploy }: { deploy: Deploy }) {
  const timeWindow = useStore((state) => state.window);
  const minLatencyMs = useStore((state) => state.traceMinLatencyMs);
  const setting = changedSetting(deploy.diff);
  // Read the same trace filter the trace pane is showing, so the share quoted
  // here and the share on screen are the same number.
  const traces = analyzeTraces(deploy.service, timeWindow, minLatencyMs, 1);
  const dominant = traces.span_breakdown[0];
  const p99 = metricStats(deploy.service, 'p99', timeWindow, METRIC_UNITS.p99);

  const links: Link[] = [
    {
      at: clock(deploy.at),
      claim: `${deploy.version} shipped`,
      target: 'pane-chart',
      targetLabel: 'the deploy marker on the chart',
    },
  ];

  if (setting) {
    links.push({
      at: 'config',
      claim: `${setting.key} ${setting.from} → ${setting.to}`,
      target: 'deploy-diff',
      targetLabel: 'the deploy diff',
    });
  }

  if (dominant) {
    links.push({
      at: 'traces',
      claim: `${dominant.pct_of_time}% in ${dominant.span}`,
      target: 'pane-traces',
      targetLabel: 'the trace span breakdown',
    });
  }

  if (p99.anomaly_start && p99.change_direction === 'increase') {
    links.push({
      at: p99.anomaly_start,
      claim: `p99 ×${p99.change_factor}`,
      target: 'pane-chart',
      targetLabel: 'the latency chart',
    });
  }

  return (
    <ol className="causal-chain" aria-label="Evidence chain supporting the rollback">
      {links.map((link, index) => (
        <li key={`${link.at}-${link.claim}`}>
          <button type="button" onClick={() => revealEvidence(link.target)} title={`Go to ${link.targetLabel}`}>
            <span>{link.at}</span>
            <strong>{link.claim}</strong>
          </button>
          {index < links.length - 1 && <CaretDown size={12} weight="bold" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
