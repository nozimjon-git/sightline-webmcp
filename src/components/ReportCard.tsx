import { ArrowsOut, Article, Check, CheckCircle, Copy, DownloadSimple, ShareNetwork, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type IncidentReport } from '../store';
import { useTouchFlash } from './Pane';

function reportMarkdown(report: IncidentReport) {
  return [
    `# ${report.incidentId} — ${report.title}`,
    '',
    ...report.sections.flatMap((section) => [
      `## ${section.heading}`,
      '',
      ...section.body.flatMap((line) => [line, '']),
    ]),
  ].join('\n').trim();
}

export function ReportCard() {
  const report = useStore((state) => state.report);
  const findings = useStore((state) => state.findings);
  const flash = useTouchFlash('report');
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const markdown = useMemo(() => report ? reportMarkdown(report) : '', [report]);
  const summary = report?.sections.find((section) => section.heading === 'Summary') ?? report?.sections[0];
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // A dialog that cannot be dismissed from the keyboard is not a dialog. Focus
  // moves in on open, Escape closes it, and focus returns to whatever opened it.
  useEffect(() => {
    if (!expanded) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setExpanded(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openerRef.current?.focus();
    };
  }, [expanded]);

  if (!report) {
    return (
      <section className={`rail-section postmortem-section ${flash.className}`} aria-labelledby="postmortem-title">
        <header className="rail-section-header">
          <h2 id="postmortem-title">Postmortem</h2>
          <span className="state-chip">Not started</span>
        </header>
        <div className="report-empty">
          <Article size={19} aria-hidden />
          <div>
            <p>No report drafted yet.</p>
            <span>{findings.length ? `${findings.length} finding${findings.length === 1 ? '' : 's'} ready for the agent to assemble.` : 'Pin findings, then ask the agent to draft the report.'}</span>
          </div>
        </div>
      </section>
    );
  }

  const copyReport = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const downloadReport = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.incidentId.toLowerCase()}-postmortem.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const shareReport = async () => {
    if (navigator.share) {
      await navigator.share({ title: `${report.incidentId} postmortem`, text: markdown });
      return;
    }
    await copyReport();
  };

  const actions = (
    <div className="report-actions">
      <button type="button" onClick={() => setExpanded(true)} aria-label="Expand postmortem"><ArrowsOut size={14} /> <span>Open</span></button>
      <button type="button" onClick={copyReport} aria-label="Copy postmortem as Markdown">{copied ? <Check size={14} /> : <Copy size={14} />} <span>{copied ? 'Copied' : 'Copy'}</span></button>
      <button type="button" onClick={downloadReport} aria-label="Download postmortem"><DownloadSimple size={14} /> <span>Download</span></button>
    </div>
  );

  return (
    <>
      <section className={`rail-section postmortem-section report-ready ${flash.className}`} aria-labelledby="postmortem-title">
        <header className="rail-section-header">
          <h2 id="postmortem-title">Postmortem</h2>
          <span className="state-chip is-ready"><CheckCircle size={13} weight="fill" /> Synced</span>
        </header>
        {actions}
        <div className="report-scroll">
          {summary && (
            <section>
              <h3>{summary.heading}</h3>
              {summary.body.map((line, index) => <p key={index}>{line}</p>)}
            </section>
          )}
          <p className="report-more">
            {report.sections.length - 1} more section{report.sections.length === 2 ? '' : 's'} —
            timeline, findings, root cause and follow-ups — in the full document.
          </p>
        </div>
      </section>

      {expanded && (
        <div className="report-modal-backdrop" role="presentation" onMouseDown={() => setExpanded(false)}>
          <article className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="eyebrow">Generated from {report.findingCount} pinned findings</span>
                <h2 id="report-modal-title">{report.incidentId} postmortem</h2>
              </div>
              <button ref={closeRef} type="button" onClick={() => setExpanded(false)} aria-label="Close postmortem"><X size={19} /></button>
            </header>
            <div className="report-modal-actions">
              <button type="button" onClick={copyReport}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy Markdown'}</button>
              <button type="button" onClick={downloadReport}><DownloadSimple size={15} /> Download .md</button>
              <button type="button" onClick={shareReport}><ShareNetwork size={15} /> Share</button>
            </div>
            <div className="report-document">
              {report.sections.map((section) => (
                <section key={section.heading}>
                  <h3>{section.heading}</h3>
                  {section.body.map((line, index) => <p key={index}>{line}</p>)}
                </section>
              ))}
            </div>
          </article>
        </div>
      )}
    </>
  );
}
