import { describe, expect, it } from 'vitest';
import { DEPLOYS, isoAtMinute, LIVE_MINUTES, METRIC_UNITS, TOTAL_MINUTES } from '../data/incident';
import { correlateDeploys, metricStats, rollbackChecks } from './analysis';
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
