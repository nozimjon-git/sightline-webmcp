import { useEffect } from 'react';
import { ActivityTicker } from './components/ActivityTicker';
import { Header } from './components/Header';
import { IncidentTimeline } from './components/IncidentTimeline';
import { LatencyChart } from './components/LatencyChart';
import { LogStream } from './components/LogStream';
import { ReportCard } from './components/ReportCard';
import { RollbackCard } from './components/RollbackCard';
import { ServiceRail } from './components/ServiceRail';
import { TraceTable } from './components/TraceTable';
import { registerTools } from './lib/webmcp';
import { TOOLS, TOOL_BY_NAME } from './tools';
import { useStore } from './store';

/** React StrictMode runs effects twice in development; registerTool() rejects a
 *  duplicate name, so registration happens exactly once per document. */
let registrationStarted = false;

export default function App() {
  const setMcp = useStore((s) => s.setMcp);

  useEffect(() => {
    if (registrationStarted) return;
    registrationStarted = true;

    // A console handle so a human (or a judge with devtools open) can exercise
    // any tool by hand, with or without a WebMCP host present:
    //   await sightline.call('query_metrics', { service: 'checkout-service', metric: 'p99' })
    Object.assign(globalThis, {
      sightline: {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        call: async (name: string, args: Record<string, unknown> = {}) => {
          const tool = TOOL_BY_NAME.get(name);
          if (!tool) throw new Error(`Unknown tool "${name}". Available: ${[...TOOL_BY_NAME.keys()].join(', ')}`);
          const result = await tool.execute(args);
          return result.content.map((c) => c.text).join('\n');
        },
      },
    });

    void registerTools(TOOLS).then((report) =>
      setMcp({ state: report.state, api: report.api, toolCount: report.toolCount, message: report.message }),
    );
  }, [setMcp]);

  return (
    <div className="app-shell flex h-full min-w-0 flex-col">
      <Header />
      <main className="app-main flex min-h-0 flex-1">
        <ServiceRail />
        <div className="center-stack flex min-h-0 min-w-0 flex-1 flex-col">
          <LatencyChart />
          <TraceTable />
          <LogStream />
        </div>
        <aside className="decision-rail flex w-[26rem] min-h-0 shrink-0 flex-col border-l border-line" aria-label="Incident decisions and report">
          <IncidentTimeline />
          <RollbackCard />
          <ReportCard />
        </aside>
      </main>
      <ActivityTicker />
    </div>
  );
}
