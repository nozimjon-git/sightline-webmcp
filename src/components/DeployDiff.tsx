/**
 * The deploy hunk, rendered as a unified diff.
 *
 * This is the one place the interface stops summarising and shows the artifact
 * itself. An on-call engineer reading `-  maximumPoolSize: 50` directly above
 * `+  maximumPoolSize: 10` does not need the incident explained to them; they
 * have shipped that line, and they recognise it. Prose about a connection pool
 * never lands the same way.
 *
 * It is also the only place a second hue is justified. Everywhere else severity
 * is carried by one alert colour and by weight; here, red-and-green is not
 * decoration, it is the notation the content is written in, and using anything
 * else would make a diff harder to read to prove a point about restraint.
 */

const ADDED = 'text-add';
const REMOVED = 'text-del';

function lineTone(line: string): { tone: string; gutter: string; bg: string } {
  if (line.startsWith('@@')) return { tone: 'text-agent', gutter: ' ', bg: '' };
  if (line.startsWith('+')) return { tone: ADDED, gutter: '+', bg: 'bg-add-wash' };
  if (line.startsWith('-')) return { tone: REMOVED, gutter: '-', bg: 'bg-del-wash' };
  return { tone: 'text-ink-faint', gutter: ' ', bg: '' };
}

export function DeployDiff({ lines, label }: { lines: string[]; label?: string }) {
  // The ---/+++ header names the file, which the caption already does.
  const body = lines.filter((l) => !l.startsWith('---') && !l.startsWith('+++'));
  if (body.length === 0) return null;
  const changed = body.filter((l) => /^[+-][^+-]/.test(l)).length;
  const file = lines.find((l) => l.startsWith('+++'))?.replace('+++ b/', '');

  return (
    <figure className="mt-2 border border-line">
      <figcaption className="flex items-baseline justify-between gap-2 border-b border-line bg-ground px-2 py-1">
        <span className="truncate font-mono text-2xs text-ink-dim">{label ?? file ?? 'diff'}</span>
        <span className="shrink-0 font-mono text-2xs tnum text-ink-faint">
          {changed} changed line{changed === 1 ? '' : 's'}
        </span>
      </figcaption>
      <div className="overflow-x-auto py-0.5">
        {body.map((line, i) => {
          const { tone, gutter, bg } = lineTone(line);
          const text = /^[+-][^+-]/.test(line) ? line.slice(1) : line;
          return (
            <div key={i} className={`flex font-mono text-2xs leading-[1.45] ${bg}`}>
              <span aria-hidden className={`w-4 shrink-0 select-none pl-1.5 ${tone}`}>
                {gutter}
              </span>
              <span className={`whitespace-pre pr-2 ${tone}`}>{text}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
