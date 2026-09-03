/**
 * The WebMCP traffic itself, the way a network tab shows a request.
 *
 * Everywhere else the console shows what a tool call *did*. This shows what was
 * actually sent and what actually came back — the arguments the agent chose and
 * the JSON the page answered with, verbatim. On a page whose entire premise is
 * a protocol between two operators, the protocol should be inspectable rather
 * than described.
 *
 * Nothing here is generated for display: both strings are captured in the tool
 * wrapper at the moment of the call.
 */

import { Check, Copy, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { ActivityEntry } from '../store';

function Payload({ title, body }: { title: string; body: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="payload-block">
      <header>
        <h4>{title}</h4>
        <span className="payload-size">{body.length.toLocaleString('en-US')} chars</span>
        <button type="button" onClick={copy} aria-label={`Copy ${title.toLowerCase()}`}>
          {copied ? <Check size={12} weight="bold" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </header>
      <pre>{body}</pre>
    </section>
  );
}

export function PayloadInspector({ entry, onClose }: { entry: ActivityEntry; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      opener?.focus();
    };
  }, [onClose]);

  return (
    <div className="payload-inspector" role="dialog" aria-modal="true" aria-label={`${entry.label} payload`}>
      <header className="payload-inspector-head">
        <span className="eyebrow">WebMCP call</span>
        <h3>{entry.label}</h3>
        <span className={`payload-status ${entry.ok ? '' : 'is-error'}`}>{entry.ok ? 'ok' : 'isError'}</span>
        <time dateTime={new Date(entry.at).toISOString()}>
          {new Date(entry.at).toLocaleTimeString('en-GB', { hour12: false })}
        </time>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close payload inspector">
          <X size={16} />
        </button>
      </header>

      <div className="payload-inspector-body">
        <Payload title="Arguments" body={entry.request ?? '{}'} />
        <Payload title="Result" body={entry.response ?? '(no payload captured)'} />
      </div>
    </div>
  );
}
