/**
 * Keyboard control.
 *
 * An incident console is used by someone who is already tense and already
 * typing. Reaching for a mouse to change a metric is the wrong ergonomics, and
 * every tool this one sits next to — vim, tmux, k9s, lazygit, htop — is driven
 * from the home row. So this one is too.
 *
 * There is a deliberate omission: nothing here approves a rollback. Approval is
 * the one irreversible act in the application and it stays a deliberate click on
 * a button that is only visible while a proposal is open. A stray keystroke
 * should never be able to ship a production change, and a shortcut for it would
 * buy a second of convenience at the cost of the guarantee the whole design is
 * built on.
 */

import { useEffect, useRef, useState } from 'react';
import { SERVICE_IDS, type MetricName } from '../data/incident';
import { matchTraces } from '../lib/analysis';
import { parseWindow } from '../lib/time';
import { nowIso, useStore } from '../store';

interface Binding {
  keys: string;
  label: string;
}

export const BINDINGS: { group: string; items: Binding[] }[] = [
  {
    group: 'Focus',
    items: [
      { keys: '[  ]', label: 'previous / next service' },
      { keys: '1 2 3', label: 'p99 · p50 · error rate' },
      { keys: 'w', label: 'cycle time window' },
    ],
  },
  {
    group: 'Evidence',
    items: [
      { keys: 'j  k', label: 'next / previous trace' },
      { keys: 'x', label: 'close the open trace' },
      { keys: '/', label: 'search the log stream' },
    ],
  },
  {
    group: 'Session',
    items: [
      { keys: '?', label: 'this list' },
      { keys: 'Esc', label: 'dismiss / leave a field' },
    ],
  },
];

const WINDOW_CYCLE = ['last_15m', 'last_30m', 'last_60m', 'full_incident'];

const isTypingTarget = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

export function useShortcuts(): { helpOpen: boolean; closeHelp: () => void } {
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Escape always works, including out of a text field.
      if (e.key === 'Escape') {
        setHelpOpen(false);
        if (isTypingTarget(e.target)) (e.target as HTMLElement).blur();
        return;
      }
      if (isTypingTarget(e.target)) return;

      const s = useStore.getState();

      switch (e.key) {
        case '?':
          e.preventDefault();
          setHelpOpen((v) => !v);
          return;
        case '/': {
          e.preventDefault();
          const input = document.querySelector<HTMLInputElement>('.logs-pane input[type="search"]');
          input?.focus();
          input?.select();
          return;
        }
        case '1':
        case '2':
        case '3': {
          const metric = (['p99', 'p50', 'error_rate'] as MetricName[])[Number(e.key) - 1];
          s.setMetric(metric, 'human');
          return;
        }
        case '[':
        case ']': {
          const i = SERVICE_IDS.indexOf(s.selectedService);
          const next = e.key === ']' ? (i + 1) % SERVICE_IDS.length : (i - 1 + SERVICE_IDS.length) % SERVICE_IDS.length;
          s.setService(SERVICE_IDS[next], 'human');
          return;
        }
        case 'w': {
          const i = WINDOW_CYCLE.findIndex((w) => parseWindow(w, nowIso(s)).label === s.window.label);
          s.setWindow(parseWindow(WINDOW_CYCLE[(i + 1) % WINDOW_CYCLE.length], nowIso(s)), 'human');
          return;
        }
        case 'x':
          if (s.selectedTraceId) s.selectTrace(null, 'human');
          return;
        case 'j':
        case 'k': {
          const traces = matchTraces(s.selectedService, s.window, s.traceMinLatencyMs);
          if (traces.length === 0) return;
          const at = traces.findIndex((t) => t.id === s.selectedTraceId);
          const step = e.key === 'j' ? 1 : -1;
          const nextIndex = at < 0 ? (e.key === 'j' ? 0 : traces.length - 1) : (at + step + traces.length) % traces.length;
          s.selectTrace(traces[nextIndex].id, 'human');
          document
            .querySelector(`[data-trace-id="${traces[nextIndex].id}"]`)
            ?.scrollIntoView({ block: 'nearest' });
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { helpOpen, closeHelp: () => setHelpOpen(false) };
}

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape is already handled globally; this moves focus in so a keyboard user
  // lands inside the dialog they just opened, and back out when it closes.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/80 px-6"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl border border-line-strong bg-pane"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-xs font-medium text-ink">Keyboard</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="control-hit font-mono text-2xs text-ink-faint hover:text-ink"
          >
            esc
          </button>
        </header>

        <div className="grid gap-x-8 gap-y-4 px-4 py-3 sm:grid-cols-3">
          {BINDINGS.map((section) => (
            <section key={section.group}>
              <h3 className="mb-1.5 text-2xs text-ink-faint">{section.group}</h3>
              <dl className="space-y-1.5">
                {section.items.map((b) => (
                  <div key={b.keys} className="flex items-baseline gap-2">
                    <dt className="shrink-0 font-mono text-2xs text-agent">{b.keys}</dt>
                    <dd className="min-w-0 text-2xs leading-snug text-ink-dim">{b.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="border-t border-line px-4 py-2 text-2xs leading-relaxed text-ink-faint">
          Approving a rollback is deliberately not bound to a key. It is the one irreversible action
          here, and it stays a click on a button that only exists while a proposal is open.
        </p>
      </div>
    </div>
  );
}
