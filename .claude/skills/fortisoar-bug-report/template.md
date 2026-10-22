=== BUG TEMPLATE ============================================================

Summary (Mantis Summary field): [Bug] [Category] <one-line root-cause title>

Body (plain text, paste below). Description folds into Pre-requisite.

Pre-requisite:
---------------------------------------------------------------------------------------------
<Description in prose: what the customer reported, what the investigation confirmed, the
isolated root cause (component, mechanism, downstream effect). Then the environment:
version/build, RAM/CPU/swap, connector versions, access (UI/API/SSH), seed data, host + date.>

---------------------------------------------------------------------------------------------
Steps to Reproduce:
1. <install deps>
2. <set env / credentials>
3. <run the repro, real script path, real flags>
4. <inspect results>

---------------------------------------------------------------------------------------------
Actual Result:
<observed behavior with exact numbers and verbatim evidence: counts, MB, ms, RSS, quoted
log lines, kernel/journal lines, config snippets.>

---------------------------------------------------------------------------------------------
Expected Result:
<numbered list of concrete, testable fixes. each names the file/setting/layer and a value.>

----------------------------------------------------------------------------------------------
Attachments:
<file name and one-line description, one per line. "none" if there are no attachments.>


=== NFR TEMPLATE ============================================================

Summary (Mantis Summary field): [NFR] [Category] <one-line title naming the missing capability>

Body (plain text, paste below). No Steps to Reproduce: an NFR asks for new behavior, so
there is nothing to reproduce. Description folds into Pre-requisite.

Pre-requisite:
---------------------------------------------------------------------------------------------
<Description in prose: what is being requested and why, the gap in the current product,
the isolated root cause of the missing capability (component, mechanism, what is absent).
Then the environment: version/build, connector versions, access (UI/API/SSH), host + date
the current behavior was confirmed.>

---------------------------------------------------------------------------------------------
Use Case:
<the concrete scenario a user cannot complete today because the capability is absent.
Not a reproduction: the goal and where the product stops short. Quote the current
schema/config that lacks the field or option, if applicable.>

---------------------------------------------------------------------------------------------
Current Behavior:
<what happens today without the feature, grounded in evidence: the missing field/option,
the error or acceptance of bad input, the workaround the customer had to build. Quote
schema snippets, config, or UI behavior verbatim. If entirely absent, state that plainly.>

---------------------------------------------------------------------------------------------
Requested Behavior:
<numbered list of concrete, testable asks. each names the component/layer/schema to change
and the behavior to add, mirroring a specific Current Behavior item.>

----------------------------------------------------------------------------------------------
Attachments:
<file name and one-line description, one per line. "none" if there are no attachments.>
