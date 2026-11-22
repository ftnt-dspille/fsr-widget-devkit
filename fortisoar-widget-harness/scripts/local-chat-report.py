#!/usr/bin/env python3
"""Digest of one `make local-chat` run. Usage: local-chat-report.py <outdir> <ask>

Reads the sidecar's trace (every connector operation + result) and writes, next to it:
  transcript.md    the ask, the assistant's text, and the cards it delivered
  tool_calls.json  each tool the model called: name, input, tier, result summary
and prints a short summary (verdict, tool names, any tool errors).
"""
import json
import os
import sys

out, ask = sys.argv[1], sys.argv[2]
frames, seen = [], set()
trace = os.path.join(out, "trace.jsonl")
if os.path.isfile(trace):
    for line in open(trace, encoding="utf-8"):
        rec = json.loads(line)
        if rec.get("operation") not in ("chat_poll", "chat_turn", "chat_resume"):
            continue
        for f in (rec.get("result") or {}).get("frames") or []:
            key = (f.get("type"), f.get("cursor"))
            if key in seen:
                continue
            seen.add(key)
            frames.append(f)
frames.sort(key=lambda f: f.get("cursor") or 0)

results = {f["tool_use_id"]: f.get("content") for f in frames if f.get("type") == "tool_result"}
calls = []
for f in frames:
    if f.get("type") != "tool_use":
        continue
    res = results.get(f["id"])
    ok = res.get("ok") if isinstance(res, dict) else None
    calls.append({"name": f.get("name"), "input": f.get("input"), "tier": f.get("tier"),
                  "ok": ok, "result": json.dumps(res, default=str)[:400]})
json.dump(calls, open(os.path.join(out, "tool_calls.json"), "w"), indent=2)

text = "".join(f.get("text", "") for f in frames if f.get("type") == "text").strip()
# Cards arrive inside the turn's stream_end transcript (the live frames carry text and tools).
cards, card_ids = [], set()
for f in frames + [x for f in frames if f.get("type") == "stream_end" for x in f.get("transcript") or []]:
    if str(f.get("type", "")).endswith("_card") or f.get("type") == "approval_request":
        if f.get("id") not in card_ids:
            card_ids.add(f.get("id"))
            cards.append(f)
md = [f"# local-chat transcript\n", f"**Analyst:** {ask}\n", f"**Assistant:**\n\n{text}\n"]
for c in cards:
    md.append(f"\n**Card `{c['type']}`:**\n```json\n{json.dumps(c, indent=2, default=str)[:3000]}\n```")
open(os.path.join(out, "transcript.md"), "w").write("\n".join(md) + "\n")

verdicts = [c for c in cards if c["type"] == "verdict_card"]
print("local-chat: tools called: " + (", ".join(c["name"] for c in calls) or "none")
      + (f" ({sum(1 for c in calls if c['ok'] is False)} errored)" if any(c["ok"] is False for c in calls) else ""))
print("local-chat: verdict card: " + (str(verdicts[-1].get("disposition")) if verdicts else "none")
      + f"; cards: {[c['type'] for c in cards]}")
