---
name: fortisoar-bug-report
description: Write a standardized FortiSOAR bug or NFR report in the official Mantis field structure. Use whenever the user asks to write up / file / format a FortiSOAR bug, defect, NFR, feature request, or performance finding, or to turn an investigation into a customer-filable report. Bugs and NFRs use different formats.
---

Produce a FortiSOAR report in the **exact** structure the engineering org files in Mantis. Two record types, each with its own format:

- `[Bug]` — something is broken relative to documented/expected behavior. Has a reproduction: Steps to Reproduce, Actual Result, Expected Result.
- `[NFR]` — a new feature request or enhancement of any kind (NFR is the customer-facing term for "new feature request", covering both brand-new capabilities and quality/performance/hardening improvements; there is no separate "feature" type). No reproduction: a feature request states a Use Case, the Current Behavior (today's limitation), and the Requested Behavior. "Feature" in the Mantis export is a severity value, not a record type.

Pick the type from the finding before writing.

## Output format (IMPORTANT)

Output is **plain text, not Markdown.** No `#` headings, no `**bold**`, no backtick fences, no Markdown tables. Mantis renders raw text. Use the field labels below literally and a row of dashes as the separator between fields. Write like an engineer filing a ticket: no em-dashes, no "Here's", no marketing adjectives, no AI throat-clearing.

### Bug format

The Mantis fields, in order. Note the **Description is folded into the Pre-requisite field** (Mantis has no separate Description box in this workflow):

```
Pre-requisite:
---------------------------------------------------------------------------------------------
<First the description in prose: what the customer reported, what the investigation
confirmed, and the isolated root cause (component, mechanism, downstream effect).
Then the environment needed to reproduce: version/build, RAM/CPU/swap, connector
versions, access (UI/API/SSH), seed data, and the actual host + date the work was done.>

---------------------------------------------------------------------------------------------
Steps to Reproduce:
<numbered, copy-pasteable. install deps, set env, run the repro. every command literal,
every flag explained in one clause, real script path, real host/port.>

---------------------------------------------------------------------------------------------
Actual Result:
<observed behavior with exact numbers and exact evidence: request counts, MB, ms, RSS,
log lines quoted verbatim, kernel/journal lines, config snippets. Quote it, do not paraphrase.>

---------------------------------------------------------------------------------------------
Expected Result:
<numbered list of concrete, testable fixes. each names the file/setting/layer to change
and the suggested value.>

----------------------------------------------------------------------------------------------
Attachments:
<list the files attached to the ticket by name, one per line, each with a one-line note on
what it is. If none, write "none".>
```

### NFR format

An NFR asks for new behavior, so there is nothing to reproduce. Drop Steps to Reproduce entirely. Replace it with a Use Case (the scenario that needs the capability), and reframe Actual/Expected as Current Behavior (today's limitation) and Requested Behavior (the ask):

```
Pre-requisite:
---------------------------------------------------------------------------------------------
<First the description in prose: what is being requested and why, the gap in the current
product, and the isolated root cause of the missing capability (component, mechanism,
what is absent). Then the environment: version/build, connector versions, access
(UI/API/SSH), and the actual host + date the current behavior was confirmed.>

---------------------------------------------------------------------------------------------
Use Case:
<the concrete scenario a user cannot complete today because the capability is absent.
Not a reproduction — a description of the goal and where the product stops short. Quote
the current schema/config that lacks the field or option, if applicable.>

---------------------------------------------------------------------------------------------
Current Behavior:
<what happens today without the feature, grounded in evidence: the missing field/option,
the error or acceptance of bad input, the workaround the customer had to build. Quote
schema snippets, config, or UI behavior verbatim. If the capability is entirely absent,
state that plainly.>

---------------------------------------------------------------------------------------------
Requested Behavior:
<numbered list of concrete, testable asks. each names the component/layer/schema to
change and the behavior to add, mirroring a specific Current Behavior item.>

----------------------------------------------------------------------------------------------
Attachments:
<list the files attached to the ticket by name, one per line, each with a one-line note on
what it is. If none, write "none".>
```

The Summary / title (`[Bug|NFR] [Category] <root-cause title>`) goes in the Mantis Summary field, separate from the body above. **The Summary field is capped at 128 characters (including the type and category tags) — Mantis truncates past that.** Keep the title within the cap and push the full detail into Pre-requisite. For an NFR the title names the missing capability and its root cause (e.g. "manual_input step input fields carry no validation block; loop workaround required"), not just the wish.

## Rules

- **Pick the format from the type.** Bug → Bug format (with Steps to Reproduce). NFR → NFR format (Use Case / Current Behavior / Requested Behavior, no Steps to Reproduce). Never paste a reproduction into an NFR; a feature request has nothing to reproduce.
- **Summary line** starts with the type tag and a category tag: `[Bug] [Stability]`, `[NFR] [Performance]`, `[Bug] [Security]`, etc. Make the title name the root cause, not just the symptom (e.g. "uwsgi worker grows unbounded because integrations_wsgi.ini sets no memory guard", not "FortiSOAR is slow").
- **Ground every claim in live evidence.** Quote log lines, `journalctl`/`dmesg` output, config file contents, schema snippets, and measured numbers verbatim. For an NFR, the evidence is the current behavior: the schema that lacks the field, the UI that accepts bad input, the workaround that had to be built. If a number isn't measured, don't state it. Never fabricate output — see the user's standing rule against fabricated commands/output.
- **Bug: Steps must be runnable as written** by someone who is not you: explicit deps, env vars, real script paths, real host/port. Prefer a single repro command over prose.
- **Bug: Actual vs Expected must mirror each other** field-for-field: each Expected item answers a specific Actual observation.
- **NFR: Current vs Requested must mirror each other** field-for-field: each Requested Behavior item answers a specific Current Behavior observation.
- **Plain text only.** No Markdown anywhere in the filed body. Separator between fields is a line of dashes (see the format blocks). Description lives inside Pre-requisite. Include the Attachments field even when it is "none".
- **Category tags** seen in practice: `Performance`, `Stability`, `Security`, `Usability`, `Scalability`, `Hardening`. Use the closest fit.
- One report = one defect. If the investigation found several vectors of the same root cause, lead with the simplest single-request reproduction (Bug) or the clearest use case (NFR) and list the others under Actual Result / Current Behavior as confirming evidence — do not split into multiple reports unless the root causes differ.
- Keep the **investigation notes** (the deep technical writeup, all vectors, dead-ends, measurements) in a separate `INVESTIGATION-*.md`; the report is the distilled, customer-filable artifact. One info-gathering report + one filed report per issue.

A worked Bug example lives at:
`fortisoar/troubleshooting/exxon-overload/BUG-REPORT.md` (report) +
`INVESTIGATION-jinja-inline-overload.md` (the info-gathering report it was distilled from).

A worked NFR example lives at:
`fortisoar/troubleshooting/manual-input-validation/NFR-manual-input-validation.md`.

A blank template for each type is in `template.md` alongside this skill.
