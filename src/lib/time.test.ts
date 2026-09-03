import { describe, expect, it } from 'vitest';
import { isoAtMinute, LIVE_MINUTES, TOTAL_MINUTES } from '../data/incident';
import { parseWindow, TimeWindowError } from './time';

describe('parseWindow telemetry boundaries', () => {
  const liveNow = isoAtMinute(LIVE_MINUTES);

  it('clamps a partially future window to the current telemetry edge', () => {
    const window = parseWindow('14:50-15:20', liveNow);
    expect(window.label).toBe('14:50-15:00');
    expect(window.endIso).toBe(liveNow);
  });

  it('rejects a window entirely after the current telemetry edge', () => {
    expect(() => parseWindow('15:01-15:20', liveNow)).toThrow(TimeWindowError);
  });

  it('rejects invalid clock values', () => {
    expect(() => parseWindow('14:99-15:00', liveNow)).toThrow(/Hours must be 00-23/);
  });

  it('unlocks the recovery interval only after approval advances now', () => {
    const window = parseWindow('15:01-15:20', isoAtMinute(TOTAL_MINUTES));
    expect(window.label).toBe('15:01-15:20');
  });
});
