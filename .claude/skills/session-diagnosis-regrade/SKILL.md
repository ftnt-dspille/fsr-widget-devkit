---
name: session-diagnosis-regrade
description: Use when diagnosing why the chat assistant misbehaved (a stored session, a failing tool, a "not intelligent" report), re-scoring an eval, reading transcripts or usage, or checking whether a harness/grader result is trustworthy before calling it a product bug.
---

# Session diagnosis and re-grading

Cheapest first: read stored data before re-driving any model.

## Where the data is
- Per-session full chain (chat, every tool_use arg, every tool_result) is persisted by the connector.
  Read it with the connector's `chat_history` / `list_sessions` / `get_session_trace` ops, or locally:
  `make session-export BOX=<alias>` (incremental) fills `~/.fsr-agentic/sessions/<alias>/`;
  `make session-summary` counts sessions per box per day (synthetic vs real).
- The sessions DB path derives from the connector name. A rename orphaned the old DB on each box
  (nothing prunes sessions); legacy copies are under `~/.fsr-agentic/legacy/<alias>/`.
- `chat_turn` responses have no top-level `usage`; usage, cost and the resolved model are an entry
  `type == "usage"` inside `transcript[]`.
- `chat_turn` builds LLM context from `params[messages]` alone. A caller that ships only the new user
  message runs the agent blind; the server-side session is never read back as context.
- Transport errors reach harnesses already rewritten by the provider (`Could not reach the ... endpoint`),
  so matching on raw `httpx.ConnectError` text scores a dead gateway as a model rejection.

## Tools (connector repo, `make help` lists all)
- `make session-health [BOX=<alias>|STORE=1] [LIMIT=30]`: failing tool calls with inputs and outputs, classed
  model_input / remote / guard / env / tool_bug, recovered vs stuck. Classification is by error CODE, never
  prose. The "what changed" arg-path diff between a failing and the succeeding call is usually the missing
  sentence in the tool description. `SESSION=<id>` prints one session's turn-by-turn diagnosis.
- `make local-turn LLM=frank ...` prints a turn DIAGNOSIS (rounds, empty/failed calls, repeats, loop
  interventions, unused tools) for a fresh turn.
- `scripts/session_analyze.py --defects`: greps every stored transcript for analyst corrections ("FIXME",
  "not what I asked") and failed outcomes. Finds defects where every tool returned `ok: true` but handed
  the model too little (disabled playbooks offered, silently truncated summaries).
- `{"error": ...}` results have no `ok` key and are not counted as failed by the call parser; check
  `raw_result` too. Synthetic `pl-*` sessions in the old local DB are test pollution and skew `SOURCE=local`.

## Re-grade, never re-drive
- Grading is a pure function of a finished conversation. `make regrade DUMP=<file>` (capture once with
  `make chat-sweep ARGS='--keep-conversations --out <file>'`) re-grades stored transcripts in ~0.2s, no
  tokens. Re-drive the model only if the connector or prompt changed.
- Stored real box sessions can be re-graded offline too (extract `chat_history`, parse scenario from the
  session id). Zero LLM cost; the only way to score a model you no longer have a key for.
- Replay recorded tool calls through old vs new tool code to test a validator or tool change
  deterministically. Apply dispatch's own coercions first or you get thousands of false positives.

## Before believing a red (harness lies that looked like product bugs)
- Vacuous graders: build turns deliver YAML via an offer card argument, not a fence, so graders that read
  fences graded nothing. Check each grader can fail on a pinned bad case.
- `yaml_text` lookups, skipped parity tests and Disconnected-connector rows were reported as failures or
  hidden as skips. A skip is not a pass; a Disconnected connector or missing seed record is SKIP, not FAIL.
- Local agent-YAML analysis and the box disagree (different data): run local AND box before concluding.
- A stale reference catalog (warm-up snapshot) makes the agent look incompetent: a connector installed
  after the last warm-up is reported "not found". Check catalog freshness before blaming the model.
- Native-MCP server map is process-global: results track worker warmth, not config, on old builds.
- Offline sweep rows resolve personas through the legacy Key Store path (cassette serves only keys), never
  the module-first path that wins on a box. Offline green does not cover persona resolution.
- Default LLM for every tier is `frank`; `LLM=fake` returns a canned string and is permanently red on
  behavioural scenarios. `--config` names that do not exist can silently fall back to the first config
  (connector `scripts/run.py` still does); pass `--expect-model`.
- Cost math: OpenAI nests cached tokens inside `input_tokens`; Anthropic keeps them disjoint. Branch on model.

