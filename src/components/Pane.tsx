import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, type Actor, type PaneId } from '../store';

/**
 * The provenance stamp is the signature of this interface. Every pane says, at
 * hairline weight in its own header, who last changed it and how — "agent ·
 * filter_traces · 14:22:07" or "you · window 14:00-14:30". On a screen two
 * parties are driving at once, that attribution is the thing you most need and
 * least often get.
 */
function Stamp({ pane, compact = false }: { pane: PaneId; compact?: boolean }) {
  const prov = useStore((s) => s.provenance[pane]);
  if (!prov) {
    return <span className="shrink-0 font-mono text-2xs whitespace-nowrap text-ink-faint">untouched</span>;
  }
  const who = prov.actor === 'agent' ? 'agent' : 'you';
  const time = new Date(prov.at).toLocaleTimeString('en-GB', { hour12: false });
  const tone = prov.actor === 'agent' ? 'text-agent' : 'text-ink-dim';
  if (compact) {
    return (
      <span className="shrink-0 font-mono text-2xs tnum whitespace-nowrap" title={`${who} · ${prov.label}`}>
        <span className={tone}>{who}</span>
        <span className="text-ink-faint"> {time}</span>
      </span>
    );
  }
  return (
    <span
      className="min-w-0 shrink font-mono text-2xs tnum overflow-hidden text-ellipsis whitespace-nowrap"
      title={`${who} · ${prov.label} · ${time}`}
    >
      <span className={tone}>{who}</span>
      <span className="text-ink-faint">
        {' · '}
        {prov.label}
        {' · '}
        {time}
      </span>
    </span>
  );
}

/** Adds the flash class for one animation cycle whenever the pane is touched. */
export function useTouchFlash(pane: PaneId): { className: string } {
  const pulse = useStore((s) => s.pulses[pane]);
  const actor: Actor = useStore((s) => s.provenance[pane]?.actor ?? 'agent');
  const [on, setOn] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(false);
    const raf = requestAnimationFrame(() => setOn(true));
    const timer = window.setTimeout(() => setOn(false), 800);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [pulse]);

  return { className: on ? `touch-flash ${actor === 'agent' ? 'flash-agent' : 'flash-human'}` : '' };
}

interface PaneProps {
  id: PaneId;
  title: string;
  /** Controls that belong to this pane, rendered between the title and stamp. */
  controls?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Narrow panes show only the actor and the time, not the action. */
  compactStamp?: boolean;
}

export function Pane({ id, title, controls, children, className = '', bodyClassName = '', compactStamp }: PaneProps) {
  const flash = useTouchFlash(id);
  return (
    <section className={`relative flex min-h-0 min-w-0 flex-col bg-pane ${className}`}>
      <header className="pane-header flex h-9 shrink-0 items-center gap-3 overflow-hidden border-b border-line px-3">
        <h2 className="shrink-0 truncate text-xs font-medium tracking-[0.03em] whitespace-nowrap text-ink">{title}</h2>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">{controls}</div>
        <Stamp pane={id} compact={compactStamp} />
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
      <div className={`pointer-events-none absolute inset-0 ${flash.className}`} aria-hidden />
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <p className="max-w-[34ch] text-center text-xs leading-relaxed text-ink-faint">{children}</p>
    </div>
  );
}
