import { ArrowRight, CheckCircle, LockKey, Robot, WarningCircle, XCircle } from '@phosphor-icons/react';
import { DEPLOYS, clock } from '../data/incident';
import { rollbackChecks } from '../lib/analysis';
import { useStore } from '../store';
import { CausalChain } from './CausalChain';
import { DeployDiff } from './DeployDiff';
import { useTouchFlash } from './Pane';

/**
 * The approval gate.
 *
 * `propose_rollback` writes a proposal and returns
 * `{ status: "awaiting_human_approval" }`. It changes nothing else. The only
 * function in the codebase that applies a rollback is `store.approveRollback`,
 * and its only caller is the onClick handler in `ApprovalFooter` below. There
 * is no tool that reaches it, and no code path from an agent to it. An agent
 * can ask; a person decides.
 *
 * Everything shown on this card is read out of the deploy fixture — the
 * version it rolls back to, the change list, the diff. Nothing here is a
 * reassuring label with no computation behind it: an approval gate is the last
 * place in an interface that should claim something it has not checked.
 */
export function RollbackCard() {
  const pending = useStore((state) => state.pendingRollback);
  const applied = useStore((state) => state.appliedRollback);
  const flash = useTouchFlash('rollback');

  // Order matters: a fresh proposal outranks an already-decided one, otherwise
  // a rollback proposed after a dismissal would never reach the screen.
  if (applied && !pending) {
    const deploy = DEPLOYS.find((item) => item.id === applied.deployId);
    const approved = applied.decision === 'approved';
    return (
      <section className={`rollback-panel decision-complete ${flash.className}`} aria-live="polite">
        <div className="decision-state-icon">
          {approved ? <CheckCircle size={22} weight="fill" /> : <XCircle size={22} weight="fill" />}
        </div>
        <div>
          <span className="eyebrow">Human decision recorded</span>
          <h2>{approved ? 'Rollback applied' : 'Rollback declined'}</h2>
          <p>
            {approved
              ? `${deploy?.service} restored to ${deploy?.previousVersion}`
              : `${deploy?.service} stays on ${deploy?.version}`}{' '}
            · {applied.deployId}
          </p>
          <p className="decision-meta">
            {approved ? 'Approved' : 'Declined'} by you at {clock(applied.decidedAt)} UTC
          </p>
          {approved && (
            <p className="decision-meta">
              Post-rollback telemetry through 15:20 is now on the chart and available to every tool.
            </p>
          )}
        </div>
      </section>
    );
  }

  if (!pending) {
    return (
      <section className={`rollback-panel empty-decision ${flash.className}`}>
        <div className="decision-placeholder">
          <Robot size={21} weight="fill" aria-hidden />
          <div>
            <span className="eyebrow">Proposed action</span>
            <h2>No mitigation proposed</h2>
            <p>
              Your agent can investigate and prepare a rollback, but it cannot execute one. When it
              calls <code>propose_rollback</code>, the request lands here and waits for your click.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const deploy = DEPLOYS.find((item) => item.id === pending.deployId);
  return (
    <section
      className={`rollback-panel pending-decision ${flash.className}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="proposal-heading">
        <div>
          <span className="eyebrow">Proposed action</span>
          <h2>Roll back {pending.service}</h2>
          <p className="proposal-reason">{pending.reason}</p>
        </div>
      </div>

      {deploy && (
        <>
          <div className="version-change" aria-label="Version change">
            <div>
              <span>Current</span>
              <strong>{deploy.version}</strong>
            </div>
            <ArrowRight size={20} />
            <div>
              <span>Target</span>
              <strong>{deploy.previousVersion}</strong>
            </div>
          </div>

          <CausalChain deploy={deploy} />

          <div className="proposal-changes">
            <p>{deploy.id} shipped {clock(deploy.at)} by {deploy.author}</p>
            <ul>
              {deploy.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>

          <div id="deploy-diff">
            <DeployDiff lines={deploy.diff} label={`${deploy.id} · ${deploy.service} ${deploy.version}`} />
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The gate itself, pinned to the bottom of the decision rail.
 *
 * Evidence is long and the decision is short, so the decision does not scroll.
 * The pre-flight checks sit directly above the buttons because they are the
 * last thing read before the click — and each one is computed in
 * `rollbackChecks`, never asserted.
 */
export function ApprovalFooter() {
  const pending = useStore((state) => state.pendingRollback);
  const approveRollback = useStore((state) => state.approveRollback);
  const rejectRollback = useStore((state) => state.rejectRollback);
  if (!pending) return null;

  const deploy = DEPLOYS.find((item) => item.id === pending.deployId);
  const checks = deploy ? rollbackChecks(deploy) : [];

  return (
    <div className="approval-footer">
      <ul className="safety-grid" aria-label="Rollback pre-flight checks">
        {checks.map((check) => (
          <li key={check.label} className={check.clear ? '' : 'needs-attention'}>
            {check.clear ? (
              <CheckCircle size={13} weight="fill" aria-hidden />
            ) : (
              <WarningCircle size={13} weight="fill" aria-hidden />
            )}
            <span>{check.label}</span>
            <strong>{check.detail}</strong>
          </li>
        ))}
      </ul>

      <div className="approval-gate">
        <span>
          <LockKey size={15} weight="fill" /> Human approval required
        </span>
        {/* The one and only path from a proposal to an applied rollback. */}
        <button type="button" className="approve-button" onClick={approveRollback}>
          Approve rollback to {deploy?.previousVersion ?? 'the previous version'}
        </button>
        <button type="button" className="decline-button" onClick={rejectRollback}>
          Decline proposal
        </button>
      </div>
    </div>
  );
}
