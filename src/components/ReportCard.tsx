import { Article, CheckCircle } from '@phosphor-icons/react';
import { useStore } from '../store';
import { useTouchFlash } from './Pane';

export function ReportCard() {
  const report = useStore((state) => state.report);
  const findings = useStore((state) => state.findings);
  const flash = useTouchFlash('report');

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

  return (
    <section className={`rail-section postmortem-section report-ready ${flash.className}`} aria-labelledby="postmortem-title">
      <header className="rail-section-header">
        <h2 id="postmortem-title">Postmortem</h2>
        <span className="state-chip is-ready"><CheckCircle size={13} weight="fill" /> Synced</span>
      </header>
      <div className="report-scroll">
        {report.sections.map((section) => (
          <section key={section.heading}>
            <h3>{section.heading}</h3>
            {section.body.map((line, index) => <p key={index}>{line}</p>)}
          </section>
        ))}
      </div>
    </section>
  );
}
