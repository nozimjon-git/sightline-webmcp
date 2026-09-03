import { DEPLOYS, clock } from '../data/incident';
import { useStore } from '../store';
import { Pane } from './Pane';

/**
 * The approval gate.
 *
 * `propose_rollback` writes a proposal and returns
 * `{ status: "awaiting_human_approval" }`. It changes nothing else. The only
 * function in the codebase that applies a rollback is `store.approveRollback`,
 * and its only caller is the onClick handler below. There is no tool that
 * reaches it, and no code path from an agent to it. An agent can ask; a person
 * decides.
 */
export function RollbackCard() {
  const pending = useStore((s) => s.pendingRollback);
  const applied = useStore((s) => s.appliedRollback);
  const approveRollback = useStore((s) => s.approveRollback);
  const rejectRollback = useStore((s) => s.rejectRollback);

  if (!pending && !applied) {
    return (
      <Pane id="rollback" title="Mitigation" className="shrink-0 border-b border-line">
        <p className="px-3 py-2 text-2xs leading-relaxed text-ink-faint">
          No mitigation proposed. When your agent calls{' '}
          <span className="font-mono text-ink-dim">propose_rollback</span>, the request lands here and waits for your
          click. Nothing ships until you approve it.
        </p>
      </Pane>
    );
  }

  if (applied) {
    const deploy = DEPLOYS.find((d) => d.id === applied.deployId);
    const ok = applied.decision === 'approved';
    return (
      <Pane id="rollback" title="Mitigation" className="shrink-0 border-b border-line">
        <div className="px-3 py-2">
          <div className="flex items-baseline gap-2">
            <span className={`h-2 w-2 shrink-0 ${ok ? 'bg-agent' : 'border border-line-strong'}`} aria-hidden />
            <span className="text-xs text-ink">
              {ok ? 'Rollback applied' : 'Rollback dismissed'} — {applied.deployId}
            </span>
          </div>
          <p className="mt-1 pl-4 font-mono text-2xs text-ink-faint">
            {deploy?.service} {deploy?.version} · deployed {deploy ? clock(deploy.at) : '—'} · approved by you
          </p>
          {ok && (
            <p className="mt-1.5 pl-4 text-2xs leading-relaxed text-ink-dim">
              Post-rollback telemetry through 15:20 is now on the chart and available to every tool.
            </p>
          )}
        </div>
      </Pane>
    );
  }

  const deploy = DEPLOYS.find((d) => d.id === pending!.deployId);
  return (
    <Pane id="rollback" title="Mitigation · awaiting your approval" className="shrink-0 border-b border-line">
      <div className="border-l-2 border-alert px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-ink">
            Roll back {pending!.service} {pending!.version}
          </span>
          <span className="font-mono text-2xs text-ink-faint">{pending!.deployId}</span>
        </div>

        <p className="mt-1.5 text-2xs leading-relaxed text-ink-dim">{pending!.reason}</p>

        {deploy && (
          <p className="mt-1.5 border-l border-line pl-2 font-mono text-2xs leading-relaxed text-ink-faint">
            {deploy.diffNote}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-2">
          {/* The one and only path from a proposal to an applied rollback. */}
          <button
            type="button"
            onClick={approveRollback}
            className="border border-alert bg-alert px-2.5 py-1 text-2xs font-medium text-ground hover:bg-[#ec7f5c]"
          >
            Approve rollback
          </button>
          <button
            type="button"
            onClick={rejectRollback}
            className="border border-line px-2.5 py-1 text-2xs text-ink-dim hover:border-line-strong hover:text-ink"
          >
            Dismiss
          </button>
          <span className="font-mono text-2xs text-ink-faint">agent is waiting</span>
        </div>
      </div>
    </Pane>
  );
}
