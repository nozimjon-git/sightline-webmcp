import { useEffect } from 'react';
import { ActivityTicker } from './components/ActivityTicker';
import { Header } from './components/Header';
import { HostBanner } from './components/HostBanner';
import { DecisionRail } from './components/DecisionRail';
import { InvestigationWorkspace } from './components/InvestigationWorkspace';
import { ServiceRail } from './components/ServiceRail';
import { ShortcutsOverlay, useShortcuts } from './components/Shortcuts';
import { registerTools } from './lib/webmcp';
import { TOOLS, TOOL_BY_NAME } from './tools';
import { useStore } from './store';

/** React StrictMode runs effects twice in development; registerTool() rejects a
 *  duplicate name, so registration happens exactly once per document. */
let registrationStarted = false;

export default function App() {
  const setMcp = useStore((s) => s.setMcp);
  const { helpOpen, closeHelp } = useShortcuts();

  useEffect(() => {
    const connect = () => {
      if (registrationStarted) return;
      registrationStarted = true;
      setMcp({ state: 'checking', api: '', toolCount: 0, message: 'Discovering the WebMCP host…' });
      void registerTools(TOOLS).then((report) => {
        setMcp({ state: report.state, api: report.api, toolCount: report.toolCount, message: report.message });
        if (report.state !== 'connected') registrationStarted = false;
      });
    };

    const retry = () => connect();
    window.addEventListener('sightline:retry-mcp', retry);

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

    connect();
    return () => window.removeEventListener('sightline:retry-mcp', retry);
  }, [setMcp]);

  return (
    <div className="app-shell flex h-full min-w-0 flex-col">
      <a className="skip-link" href="#investigation">
        Skip to the evidence
      </a>
      <Header />
      <HostBanner />
      <main className="app-main flex min-h-0 flex-1">
        <ServiceRail />
        <div className="workspace-stack flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="workspace-body flex min-h-0 min-w-0 flex-1">
            <InvestigationWorkspace />
            <DecisionRail />
          </div>
          <ActivityTicker />
        </div>
      </main>
      <ShortcutsOverlay open={helpOpen} onClose={closeHelp} />
    </div>
  );
}
