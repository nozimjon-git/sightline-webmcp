import { describe, expect, it } from 'vitest';
import { DEPLOYS, isoAtMinute, LIVE_MINUTES, METRIC_UNITS, TOTAL_MINUTES } from '../data/incident';
import { correlateDeploys, metricStats, rollbackChecks, serviceHealth } from './analysis';
import { parseWindow } from './time';

describe('metric recovery analysis', () => {
  it('identifies the post-rollback p99 recovery instead of calling it flat', () => {
    const now = isoAtMinute(TOTAL_MINUTES);
    const window = parseWindow('14:50-15:20', now);
    const stats = metricStats('checkout-service', 'p99', window, METRIC_UNITS.p99);

    expect(stats.change_direction).toBe('decrease');
    expect(stats.recovery_start).not.toBeNull();
    expect(stats.recovery_factor).not.toBeNull();
    expect(stats.recovery_factor!).toBeGreaterThan(3);
    expect(stats.current).toBeLessThan(1000);
    expect(stats.time_to_slo_minutes).not.toBeNull();
    expect(stats.sample_points.at(-1)?.t).toBe('15:20');
  });
});

describe('deploy correlation', () => {
  it('keeps an anomaly that starts exactly on the requested window boundary', () => {
    const window = parseWindow('14:20-15:00', isoAtMinute(LIVE_MINUTES));
    const result = correlateDeploys(window, [], 'checkout-service');

    expect(result.anomaly_start).toBe('14:20');
    expect(result.deploys[0].deploy_id).toBe('dep-1104');
    expect(result.deploys[0].proximity_score).toBeGreaterThan(0.5);
  });
});

describe('rollback pre-flight checks', () => {
  it('derives every check from the deploy rather than asserting one', () => {
    const checks = rollbackChecks(DEPLOYS.find((d) => d.id === 'dep-1104')!);

    expect(checks.map((c) => c.label)).toEqual(['Restore target', 'Later deploys', 'Migrations', 'Authority']);
    expect(checks.find((c) => c.label === 'Restore target')?.detail).toBe('v2.14 → v2.13');
    expect(checks.every((c) => c.clear)).toBe(true);
  });

  it('flags a deploy that another release has already landed on top of', () => {
    const checks = rollbackChecks(DEPLOYS.find((d) => d.id === 'dep-1091')!);
    const later = checks.find((c) => c.label === 'Later deploys')!;

    expect(later.clear).toBe(true);

    const userService = rollbackChecks({
      ...DEPLOYS.find((d) => d.id === 'dep-1112')!,
      at: isoAtMinute(1),
    });
    expect(userService.find((c) => c.label === 'Later deploys')?.clear).toBe(false);
  });
});

describe('a degraded service the change-point detector does not fire on', () => {
  const now = isoAtMinute(LIVE_MINUTES);
  const window = parseWindow('full_incident', now);
  const health = serviceHealth(now, []);

  it('says why the detector and the alert threshold disagree', () => {
    const gateway = health.find((h) => h.service === 'payment-gateway')!;
    expect(gateway.status).toBe('degraded');

    const stats = metricStats('payment-gateway', 'p99', window, 'ms', gateway.alert_names);
    expect(stats.anomaly_start).toBeNull();
    expect(stats.note).toContain('active alert');
    expect(stats.note).toContain('drift rather than a step change');
    // And it points at the service that calls this one.
    expect(stats.note).toContain('checkout-service');
  });

  /**
   * inventory-service runs at 2.84x its baseline with no alert firing — it is
   * the fixture's red herring. Lowering the detector to 2x to "catch degraded
   * services" would make it report a change point and strengthen the false
   * lead, so the threshold stays where it is and only the note changes.
   */
  it('stays quiet about a service that is merely noisy', () => {
    const inventory = health.find((h) => h.service === 'inventory-service')!;
    expect(inventory.active_alerts).toBe(0);

    const stats = metricStats('inventory-service', 'p99', window, 'ms', inventory.alert_names);
    expect(stats.change_factor).toBeGreaterThan(2);
    expect(stats.anomaly_start).toBeNull();
    expect(stats.note).not.toContain('active alert');
  });
});
