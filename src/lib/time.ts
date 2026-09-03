/**
 * Time-window parsing.
 *
 * Agents are bad at absolute timestamps and good at phrases like "last 30
 * minutes", so every tool that takes a window accepts three notations. When
 * parsing fails we return the accepted notations rather than "invalid input" —
 * a tool error is a chance to teach the caller how to retry.
 */

import { INCIDENT_DATE, T0_ISO, isoAtMinute, TOTAL_MINUTES, clock } from '../data/incident';

export interface TimeWindow {
  startIso: string;
  endIso: string;
  /** "14:00-14:30" — how the window reads in the UI and in tool output. */
  label: string;
}

export const WINDOW_PRESETS = [
  'last_10m',
  'last_15m',
  'last_30m',
  'last_60m',
  'last_90m',
  'full_incident',
] as const;

export type WindowPreset = (typeof WINDOW_PRESETS)[number];

const PRESET_MINUTES: Record<Exclude<WindowPreset, 'full_incident'>, number> = {
  last_10m: 10,
  last_15m: 15,
  last_30m: 30,
  last_60m: 60,
  last_90m: 90,
};

export const WINDOW_SYNTAX_HELP =
  'Accepted formats: a preset (' +
  WINDOW_PRESETS.join(', ') +
  '); a clock range on the incident day such as "14:00-14:30"; or an ISO range such as ' +
  `"${INCIDENT_DATE}T14:00:00Z/${INCIDENT_DATE}T14:30:00Z".`;

const DATA_START = T0_ISO;
const DATA_END = isoAtMinute(TOTAL_MINUTES);

const clampIso = (iso: string): string => {
  if (iso < DATA_START) return DATA_START;
  if (iso > DATA_END) return DATA_END;
  return iso;
};

export const labelFor = (startIso: string, endIso: string): string => `${clock(startIso)}-${clock(endIso)}`;

const makeWindow = (startIso: string, endIso: string): TimeWindow => {
  const s = clampIso(startIso);
  const e = clampIso(endIso);
  return { startIso: s, endIso: e, label: labelFor(s, e) };
};

export class TimeWindowError extends Error {}

/**
 * @param raw   the caller-supplied window string
 * @param nowIso the current edge of the data (15:00 live, 15:20 after a rollback)
 */
export function parseWindow(raw: string | undefined, nowIso: string): TimeWindow {
  const input = (raw ?? 'full_incident').trim().toLowerCase().replace(/\s+/g, '');

  if (input === 'full_incident' || input === 'all' || input === 'incident') {
    return makeWindow(DATA_START, nowIso);
  }

  if (input in PRESET_MINUTES) {
    const minutes = PRESET_MINUTES[input as keyof typeof PRESET_MINUTES];
    return makeWindow(new Date(Date.parse(nowIso) - minutes * 60_000).toISOString(), nowIso);
  }

  // Bare "last_Nm" that is not one of the presets — accept it rather than fail.
  const relative = /^last_?(\d{1,3})m(in(utes)?)?$/.exec(input);
  if (relative) {
    const minutes = Number(relative[1]);
    if (minutes > 0) {
      return makeWindow(new Date(Date.parse(nowIso) - minutes * 60_000).toISOString(), nowIso);
    }
  }

  // Clock range on the incident day: 14:00-14:30 (also accepts 14:00:00-14:30:00)
  const clockRange = /^(\d{1,2}):(\d{2})(?::\d{2})?[-–to]{1,2}(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(input);
  if (clockRange) {
    const [, h1, m1, h2, m2] = clockRange;
    const start = `${INCIDENT_DATE}T${h1.padStart(2, '0')}:${m1}:00.000Z`;
    const end = `${INCIDENT_DATE}T${h2.padStart(2, '0')}:${m2}:00.000Z`;
    if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      throw new TimeWindowError(`Could not read "${raw}" as a clock range. ${WINDOW_SYNTAX_HELP}`);
    }
    if (end <= start) {
      throw new TimeWindowError(
        `Window "${raw}" ends at or before it starts. Put the earlier time first, e.g. "14:00-14:30".`,
      );
    }
    return makeWindow(new Date(start).toISOString(), new Date(end).toISOString());
  }

  // ISO range: <iso>/<iso> or <iso>..<iso>
  const isoRange = input.split(/\/|\.\./);
  if (isoRange.length === 2) {
    const start = Date.parse(isoRange[0]);
    const end = Date.parse(isoRange[1]);
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      if (end <= start) {
        throw new TimeWindowError(`Window "${raw}" ends at or before it starts. Put the earlier timestamp first.`);
      }
      return makeWindow(new Date(start).toISOString(), new Date(end).toISOString());
    }
  }

  throw new TimeWindowError(
    `Could not read "${raw}" as a time window. ${WINDOW_SYNTAX_HELP} ` +
      `All incident data is on ${INCIDENT_DATE} between ${clock(DATA_START)} and ${clock(nowIso)} UTC.`,
  );
}

/** True when `iso` falls inside the window (start inclusive, end inclusive). */
export const inWindow = (iso: string, w: TimeWindow): boolean => iso >= w.startIso && iso <= w.endIso;

export const windowMinutes = (w: TimeWindow): number =>
  Math.round((Date.parse(w.endIso) - Date.parse(w.startIso)) / 60_000);
