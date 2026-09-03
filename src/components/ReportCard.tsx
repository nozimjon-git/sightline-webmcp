import { useStore } from '../store';
import { Pane } from './Pane';

export function ReportCard() {
  const report = useStore((s) => s.report);

  if (!report) {
    return (
      <Pane id="report" title="Postmortem" className="shrink-0">
        <p className="px-3 py-2 text-2xs leading-relaxed text-ink-faint">
          No report drafted. Once findings are pinned, ask your agent to call{' '}
          <span className="font-mono text-ink-dim">draft_incident_report</span> and the assembled postmortem appears
          here.
        </p>
      </Pane>
    );
  }

  return (
    <Pane
      id="report"
      title="Postmortem"
      className="decision-report min-h-[10rem] flex-1 basis-0"
      bodyClassName="overflow-y-auto"
      controls={
        <span className="shrink-0 font-mono text-2xs whitespace-nowrap text-ink-faint">
          synced · {report.findingCount} findings
        </span>
      }
    >
      <div className="px-3 py-2">
        {report.sections.map((section) => (
          <section key={section.heading} className="mb-3 last:mb-0">
            <h3 className="mb-1 border-b border-line pb-0.5 text-2xs font-medium text-ink">{section.heading}</h3>
            <ul className="space-y-1">
              {section.body.map((line, i) => (
                <li key={i} className="whitespace-pre-line font-mono text-2xs leading-relaxed text-ink-dim">
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Pane>
  );
}
