/**
 * WebMCP registration adapter.
 *
 * The spec (https://webmachinelearning.github.io/webmcp/) puts the imperative
 * API on `document.modelContext`:
 *
 *   Promise<undefined> registerTool(ModelContextTool tool,
 *                                   optional ModelContextRegisterToolOptions options = {});
 *
 * Shipped examples and earlier drafts also used `navigator.modelContext`, and
 * some hosts still expose the older `provideContext({ tools })` batch shape, so
 * we probe all three and report which one we found. Nothing here guesses: if no
 * host is present the app says so on screen and keeps working for a human.
 *
 * Two details worth calling out, both learned from the spec text rather than
 * from memory:
 *
 * 1. `registerTool()` rejects with a SecurityError unless the document's agent
 *    cluster is origin-keyed. That is why this app ships
 *    `Origin-Agent-Cluster: ?1` (vite.config.ts, public/_headers, netlify.toml)
 *    and why we surface `window.originAgentCluster` in the diagnostic.
 *
 * 2. When an execute callback's promise *rejects*, the spec discards the reason
 *    and reports a bare failure to the agent. A rejection therefore throws away
 *    the retry hint we worked hard to write. So tools never throw: they resolve
 *    with `{ isError: true, content: [...] }` and the message survives.
 */

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<ToolResult>;
}

interface ModelContextLike {
  registerTool?: (tool: unknown, options?: { signal?: AbortSignal }) => Promise<void>;
  provideContext?: (context: { tools: unknown[] }) => void | Promise<void>;
}

export interface RegistrationReport {
  state: 'connected' | 'unavailable' | 'error';
  /** Which host object and method we actually used. */
  api: string;
  toolCount: number;
  message?: string;
}

declare global {
  interface Document {
    modelContext?: ModelContextLike;
  }
  interface Navigator {
    modelContext?: ModelContextLike;
  }
}

function findHost(): { host: ModelContextLike; where: string } | null {
  if (typeof document !== 'undefined' && document.modelContext) {
    return { host: document.modelContext, where: 'document.modelContext' };
  }
  if (typeof navigator !== 'undefined' && navigator.modelContext) {
    return { host: navigator.modelContext, where: 'navigator.modelContext' };
  }
  return null;
}

function originIsolationHint(): string {
  const isolated = (globalThis as { originAgentCluster?: boolean }).originAgentCluster;
  if (isolated === undefined) return '';
  return isolated
    ? ' (this document is origin-keyed, so that is not the cause)'
    : ' — this document is NOT origin-keyed; WebMCP needs the Origin-Agent-Cluster: ?1 response header';
}

/** Strip the execute callback for a legacy host that wants a plain descriptor. */
const descriptorOf = (t: ToolDefinition) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: t.inputSchema,
  annotations: t.annotations,
  execute: t.execute,
});

export async function registerTools(tools: ToolDefinition[]): Promise<RegistrationReport> {
  const found = findHost();

  if (!found) {
    const message =
      'No WebMCP host found: neither document.modelContext nor navigator.modelContext exists. ' +
      'Open this page in ChatGPT, or in Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled. ' +
      'The console panel below still lets you drive every tool by hand.';
    console.warn(`[sightline] ${message}`);
    return { state: 'unavailable', api: 'none', toolCount: 0, message };
  }

  const { host, where } = found;

  if (typeof host.registerTool === 'function') {
    const failures: string[] = [];
    for (const tool of tools) {
      try {
        await host.registerTool(descriptorOf(tool));
      } catch (err) {
        failures.push(`${tool.name}: ${(err as Error)?.message ?? String(err)}`);
      }
    }
    if (failures.length === tools.length) {
      const message = `${where}.registerTool() rejected every tool${originIsolationHint()}. First error — ${failures[0]}`;
      console.error(`[sightline] ${message}`);
      return { state: 'error', api: `${where}.registerTool`, toolCount: 0, message };
    }
    if (failures.length > 0) {
      console.warn('[sightline] some tools failed to register:', failures);
    }
    const registered = tools.length - failures.length;
    console.info(
      `[sightline] registered ${registered} WebMCP tool(s) via ${where}.registerTool:`,
      tools.map((t) => t.name).join(', '),
    );
    return {
      state: 'connected',
      api: `${where}.registerTool`,
      toolCount: registered,
      message: failures.length ? `${failures.length} tool(s) failed: ${failures.join('; ')}` : undefined,
    };
  }

  if (typeof host.provideContext === 'function') {
    try {
      await host.provideContext({ tools: tools.map(descriptorOf) });
      console.info(`[sightline] registered ${tools.length} WebMCP tool(s) via ${where}.provideContext`);
      return { state: 'connected', api: `${where}.provideContext`, toolCount: tools.length };
    } catch (err) {
      const message = `${where}.provideContext() failed${originIsolationHint()}: ${(err as Error)?.message ?? String(err)}`;
      console.error(`[sightline] ${message}`);
      return { state: 'error', api: `${where}.provideContext`, toolCount: 0, message };
    }
  }

  const message =
    `Found ${where} but it exposes neither registerTool() nor provideContext(). ` +
    `Available keys: ${Object.keys(host).join(', ') || '(none enumerable)'}.`;
  console.error(`[sightline] ${message}`);
  return { state: 'error', api: where, toolCount: 0, message };
}
