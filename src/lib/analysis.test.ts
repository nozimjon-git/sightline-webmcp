import { describe, expect, it } from 'vitest';
import { isoAtMinute, METRIC_UNITS, TOTAL_MINUTES } from '../data/incident';
import { metricStats } from './analysis';
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
