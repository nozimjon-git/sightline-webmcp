# Sightline — public demo script

Target runtime: 2:30–2:50. Record at 1280×720 or higher with browser zoom at
100%. Narration should be audible throughout.

## 0:00–0:20 — the problem

Show the live URL and the active incident.

> Incident response breaks when the human and the AI work in separate worlds.
> Sightline is a WebMCP incident room where both operate the same screen, with
> visible provenance and a human gate for production changes.

## 0:20–0:40 — shared context

Drag the chart window and select a trace. Ask the agent: “What am I looking at?”
Let it invoke `get_current_view`, then point to the handoff indicator.

> The agent receives my exact service, metric, time range, filters, and open
> trace through a typed tool—not by scraping the interface.

## 0:40–1:35 — investigation

Prompt: “Checkout p99 is spiking. Find out why.” Show the visible effects of
health, metric, trace, log, and deploy calls.

> Every read changes the shared view. The agent separates p99 from p50,
> localizes the wait to database connection acquisition, finds the matching
> timeout pattern, and correlates it with deploy dep-1104. Results are computed
> from the telemetry fixture rather than returned as hard-coded answers.

## 1:35–2:10 — human control

Show the pinned root-cause finding and rollback proposal. Pause on the approval
card, then click Approve yourself.

> The agent can propose a rollback, but it cannot execute one. Only this human
> click advances the incident clock, reveals recovery telemetry, and clears the
> alerts.

## 2:10–2:35 — recovery and report

Show the recovery line, healthy service state, synchronized postmortem, and
activity ticker.

> Sightline detects the recovery, measures time back to SLO, refreshes the
> report, and keeps every human and agent action attributable on screen.

## 2:35–2:50 — close

Show the WebMCP badge and repository briefly.

> Nine bounded WebMCP tools turn incident response into one supervised,
> inspectable workflow for both people and agents.

Before submitting, upload the final recording publicly to YouTube and add its
URL beside the live-demo link in the main README and Devpost form.
