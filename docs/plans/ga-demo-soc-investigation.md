# GA demo — SOC assistant investigation → action

**Goal (user's words):** make the SOC assistant *look really good in a demo*.
A story that is **easy to explain**, shows the widget reaching into **MCP
servers**, and ends with the assistant **actually executing** a containment
action — block an IP on FortiGate, isolate a host on FortiEDR.

**Status:** discovery done, demo not yet built. This doc is the pick-up point
after a context clear.

---

## 1. The box

**GA = `10.99.249.159:13000`** (`.env.fsr-ga`; same appliance as `.env.159`,
which splits the port into `FSR_PORT`). SSH: `ssh fsr159` / `ssh fsr8`.

### 🔑 The connector's name is `connector-fsr-soc-assistant` — everywhere

Not GA-specific, and **not** a box quirk. Verified three ways:

| source | name |
|---|---|
| `connector-fsr-soc-assistant/info.json` | `connector-fsr-soc-assistant` v0.5.0 |
| box **206** | `connector-fsr-soc-assistant` 0.5.0 |
| box **GA/159** | `connector-fsr-soc-assistant` 0.5.0 |

`fortinet-fsr-playbook-builder` is the **pre-rename** name and exists on
**neither** box; calling it returns a confident-sounding lie that reads like a
box outage rather than a stale string:

    CS-INTEGRATION-5: Connector fortinet-fsr-playbook-builder does not exists

`scripts/fsr_live.py` was always correct. `scripts/session_analyze.py` shipped
with the stale constant (author error, taken from a stale memory entry) — now
**derived from `info.json` at import**, not hardcoded, per the
connector-identity-has-ONE-SOURCE rule in `TESTING.md`. Box pulls verified
working against GA afterwards.

⚠️ Anything else that hardcodes a connector name is suspect for the same
reason. Prefer reading `info.json`.

Separately: the pyfsr client default timeout is 30s and a real triage turn
exceeds it — use `EnvConfig.from_env_file(ENV).client(timeout=600)`.

---

## 2. What GA can actually do — measured 2026-07-21

| connector | version | configured | demo role |
|---|---|---|---|
| `connector-fsr-soc-assistant` | 0.5.0 | ✅ 2 configs | the assistant itself |
| `fortigate-firewall` | 5.4.0 | ✅ 1 config | **block IP — VIABLE** |
| `fortigate-cloud` | 1.0.0 | ✅ 1 | |
| `fortinet-fortiguard-threat-intelligence` | 4.1.0 | ✅ 1 | enrichment / TI story |
| `fortinet-fortiguard-ioc` | 1.1.0 | ✅ 1 | enrichment |
| `fortinet-fortiguard-outbreak` | 3.0.0 | ✅ 1 | enrichment |
| `fortinet-fortimanager-json-rpc` | 1.1.0 | ✅ 1 | |
| `fortisoar-soc-simulator` | 2.0.0 | ✅ 1 | demo data generator |
| **`fortinet-fortiedr`** | 2.1.0 | ❌ **0 configs** | **isolate host — BLOCKED** |
| `virustotal` | 3.2.1 | ❌ 0 | |
| `fortinet-forticlient-ems` | 1.2.0 | ❌ 0 | |
| `fsr-agent-communication-bridge` | 1.3.0 | ❌ 0 | **the MCP bridge — BLOCKED** |

**Two blockers for the story as described:**
1. **FortiEDR has no configuration** → "isolate the host" cannot execute. Either
   configure it (needs creds/appliance) or build the demo's containment beat
   around **FortiGate block-IP**, which is ready today.
2. **`fsr-agent-communication-bridge` has no configuration** → the MCP-server
   reach-out beat needs this wired. See [[ga_159_fortiai_mcp_architecture]] —
   `/opt/mcp-server` is the gateway and **no REST API executes a registered
   external MCP tool; the bridge only fires inside an agent investigation**,
   which is exactly the demo path, so this is worth fixing rather than routing
   around.

---

## 3. Demo record candidates (real data on GA — 115,323 alerts, 1 incident)

Recent Critical alerts that already carry linked indicators, so an investigation
has something to pivot on:

| alert | sev | indicators | why it demos well |
|---|---|---|---|
| **Ransomware Precursor: vssadmin Delete Shadows on app-65** | Critical | 4 | instantly legible stakes; "delete shadow copies" is the universally understood pre-ransomware move |
| **Pass-the-Hash from laptop-24 — 11 Lateral Hops** | Critical | 4 | a *spread* story — natural setup for "how far did it get?" |
| **S3 Exfil: 3668 Objects from prod-customer-data-…** | Critical | 3 | data-loss framing, good for exec audiences |
| Crypto Mining Activity - EC2 i-0a1b… | Critical | 3 | cloud angle |

⚠️ Only **1 incident** exists on GA — an incident-level demo would need one
created (`fortisoar-soc-simulator` is configured and can generate data).

**Recommended:** *Ransomware Precursor* for the main beat (clearest stakes,
fastest to explain) with *Pass-the-Hash* as the scope/blast-radius follow-up.

---

## 4. The story to build toward

1. **Analyst opens the alert.** Widget mounts the record — no copy-paste.
2. **"What happened here and how bad is it?"** → assistant grounds in the real
   record, names the host and the indicators. *(This beat is already covered
   offline by the new T1 investigation scenarios — see §6h of
   `widget-capability-test-and-persona-rollout.md`.)*
3. **Enrichment / MCP reach-out** — TI lookup on the indicators. FortiGuard TI
   is configured; the MCP bridge is not (blocker #2).
4. **"How far did this spread?"** → pivot to related records.
5. **🎯 THE MONEY BEAT — "block that IP" / "isolate that host."** The assistant
   proposes a containment action the analyst approves, then it **executes**.

### ✅ Beats 1–4 ALREADY WORK ON GA — live-verified 2026-07-21

Drove a real turn on GA against *Ransomware Precursor: vssadmin Delete Shadows
on **filesrv-42*** (there are several instances of this alert; pick one at demo
time). `stop=end_turn`, **30s**, `gpt-4.1-mini`:

    TOOLS: find_enrichment_actions ×4, run_op ×4
    FRAMES: info_card, text, tool_result, tool_use, usage

It **executed real enrichment** (`run_op` ×4) and came back grounded and
specific — host `filesrv-42`, IP `10.6.11.152`, user `crichmond`, the exact
command line `vssadmin.exe delete shadows /all /quiet`, parent `powershell.exe`,
the hash, **Qakbot attribution**, a related CVE, and an explicit note that the
other indicators had *no* TI hits (honest about the gaps). It closes with a
severity verdict and a recommended next step.

**This demos well as-is.** No prompt work needed for the first four beats. Full
transcript: `scratchpad/ga_demo.log`; probe: `scratchpad/ga_demo_probe.py`.

### 🔴 Beat 5 — the gap, now CONFIRMED LIVE ON GA

The same turn ended with:

> *"Isolate the affected endpoint from the network immediately…"*

…and emitted **`info_card` only — no `action_card`.** The assistant *recommends*
containment in prose but **offers the analyst no button to do it**. So the demo
currently ends on advice, not action — exactly the beat the story is built
around.

This is the local-corpus emit-card finding reproduced on the GA box with the
actual demo record, which removes the "maybe it's just dev traffic" caveat: the
action surface really is not firing on a case that plainly warrants it.

Beat 5 is both the best story and **the least-exercised code in the product.**
Measured across 481 local sessions / 1218 tool calls, the whole interactive-card
surface fired **16 times**:

    emit_action_card 4 · emit_decision_step 7 · emit_playbook_offer 2
    emit_capability_gap_card 2 · emit_choice_card 1 · emit_manual_input 0

`emit_action_card` — the "Block this IP" button — fired **4 times ever**, and we
**cannot yet tell whether the model rarely chooses it, or the path is broken and
never reached.** Nothing tests it. There is also **zero** coverage of the
follow-up-turn shape ("ok, block it") because the offline rig is single-turn.

**Do not assume beat 5 works.** Prove it end-to-end on GA before demoing it.

---

## 4b. 🔬 BEAT 5 ROOT-CAUSED ON GA — 2026-07-21 (session 4e)

Drove the real two-turn shape on GA (`scratchpad/ga_beat5_probe.py`,
transcripts in `scratchpad/ga_beat5.json`): turn 1 investigate, turn 2
*"ok, block that IP"* / *"ok, isolate that host now"*.

**The action-card path is NOT broken.** Turn 2 of the isolate-host run ended
`stop=awaiting_action_card` with a real `action_card` frame carrying an
`approval_id`. The "maybe the emit path never works" hypothesis is dead — and
the model does *want* to contain: it called `find_containment_actions` as its
very first move on both runs.

Three distinct causes, all found:

**① 🐛 The hunt-floor guard blocks containment on the follow-up turn (FIXED + SHIPPED).**
`find_containment_actions` was refused with `hunt_floor_guard`,
`investigation_calls: 0 / required: 3` — *after* a turn-1 investigation that ran
`fmg_get_device_status`, `fmg_get_ha_status`, `fmg_get_policy_package_status`
and `faz_search_device_events`. None of those names were in the framework's
hardcoded `_INVESTIGATION_TOOLS`, so a genuine investigation scored **zero**
evidence. The model then burned the whole turn satisfying the floor and staged
an *enrichment* op (`fortinet-fortiguard.ip_reputation`) as the action card
instead of containment.
Same Option-A drift as `TRIAGE_ONLY_TOOLS`: the connector registers its hunt
tools at import but nothing extended the floor's set.
Fix: `_INVESTIGATION_TOOLS` is now a mutable set plus `siem_`/`faz_`/`fmg_`
family prefixes (`counts_as_investigation`), and the connector's
`register_triage_tools()` calls the new `credit_as_investigation(...)`.
Framework `_loop_helpers.py` + connector `fsr_soc_triage/registry.py`;
2 regression tests. Shipped in framework **0.4.39**.

**② 🔴 GA's `fortigate-firewall` config is Disconnected** — healthcheck says
*"Invalid endpoint or credentials"* (config `test`, pointed at a fortidemo host,
proxied through a FortiSOAR Agent). So **block-IP containment genuinely does not
exist on GA today**, and `find_containment_actions(target_type="ip")` correctly
returned `actions: []` → the assistant emitted a capability-gap card. That
behaviour is *right*; the box is wrong. Fix the config or drop block-IP from the
demo.

**④ 🐛 `isolate_collector` was invisible to containment discovery AND ungated
(FIXED + SHIPPED).** With ① fixed, the assistant staged
`fortinet-fortiedr.remediate_device` ("Kill Process") — the wrong op — because
FortiEDR's real isolate op is categorized **`investigation`** in the catalog and
had **no `op_safety` verdict** on GA (only 391 of 466 catalogued ops carry one).
`_tier_for_run_op` therefore resolved it to **tier 2**: `run_op` would have
ISOLATED A HOST WITH NO APPROVAL CARD, and `find_containment_actions` dropped it
from its tier≥3 slice. Fix: `_op_name_is_destructive()` reuses the exact verb +
non-action-prefix lists `find_containment_actions` classifies with, so discovery
and the approval gate cannot disagree. Framework **0.4.40**, connector **0.5.2**.

**③ ✅ `fortinet-fortiedr` IS configured and Available on GA** — the §2 table
above ("0 configs, isolate host BLOCKED") is **stale**. Isolate-host is the
viable containment beat. Full health sweep 2026-07-21: Available =
fortinet-fortiedr, fortinet-fortiai-proxy, smtp, fortisoar-soc-simulator,
fortinet-fortiguard-{threat-intelligence,ioc,outbreak}, mitre-attack,
code-snippet. Disconnected = fortigate-firewall, exchange. No config =
cisa-advisory, smtp_ng.

---

## 5. RESUME HERE — ordered

1. ✅ **BEAT 5 FIRES — DONE, live-proven on GA 2026-07-22.** Framework
   **0.4.40** + connector **0.5.2** shipped (7/7 workers, warmup green).
   Turn 2 of `scratchpad/ga_beat5_probe.py "Ransomware Precursor" "ok, isolate
   that host now"`, reproduced twice on different records:

       stop: awaiting_action_card | 7-8s
       TOOLS: find_containment_actions, emit_action_card
       emit_action_card(connector="fortinet-fortiedr", operation="isolate_collector",
                        args={"type":"Name","devices":"<the alert's host>"})

   The card carries an `approval_id` and the op's full `param_schema`, so the
   widget renders an editable approve/reject form. **The demo now ends on an
   action, not advice.** Remaining: rehearse it through the WIDGET (this proof
   is connector-level), and decide whether to actually approve-and-execute the
   isolate on stage.
   Drive a SECOND turn on the same session saying *"block that IP"* /
   *"isolate that host"* and read the transcript: does an `action_card` frame
   appear, is the indicator bound correctly, does the tier-≥3 approval gate it,
   and does execution actually reach `fortigate-firewall`?
   Extend `scratchpad/ga_demo_probe.py` (correct connector name + 600s timeout
   already wired) to pass `messages=[…prior turn…, {"role":"user","content":
   "block that IP"}]`.
   The turn-1 evidence says the model *knows* containment is the right move —
   it said so in prose — so the likely cause is the tool not being offered,
   reachable, or described well enough in the triage slice, rather than the
   model declining. Check in this order: (a) is `emit_action_card` even in the
   triage intent slice at runtime, (b) does the prompt tell it to offer one,
   (c) does the model pick it when explicitly asked.
2. ~~Fix the connector-name drift~~ — ✅ **DONE.** `session_analyze.py` now
   derives the name from `info.json`; GA box pulls verified working.
3. **Decide the containment beat**: configure FortiEDR (unblocks "isolate host")
   or build around FortiGate block-IP (ready now).
4. **Wire `fsr-agent-communication-bridge`** if the MCP beat stays in the story.
5. **Add a multi-turn offline scenario** for investigate → act, so beat 5 stops
   being untested (plan §6h.2 item 1). The T1 rig gained record-mounting this
   session; it still needs multi-turn.
6. **Rehearse end-to-end** on the exact record, and capture the transcript as
   the demo script.

## 6. Context carried in

- Offline SOC-investigation scenarios now exist (`31b8e18`) — beats 2/4 are
  regression-tested box-free. See [[soc_investigation_offline_coverage_and_emit_card_gap]].
- Boxes default to **gpt-4.1-mini** ([[boxes_default_config_gpt41mini]]); it
  fixed confabulation but is more under-confident on authoring — for a triage
  demo that trade is in our favour.
- Framework compiler fixes from this session are **offline-proven and unshipped**;
  they do not affect the triage demo path.
