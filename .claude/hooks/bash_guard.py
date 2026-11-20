#!/usr/bin/env python3
"""Claude Code PreToolUse guard for Bash: blocks a SHORT list of commands
agents have typed before and should never type, naming the right command.

It is a backstop for patterns already seen, not the policy: the make targets
and git hooks enforce the rules. Input: the hook JSON on stdin. Exit 2 blocks
(stderr goes back to the agent); 0 allows.
"""
import json
import re
import sys

RULES = [
    # A make front door exists for these; calling the script skips its checks.
    # Only RUNNING one: bash/sh/python <path>, ./<path>, or a path at a command start.
    (re.compile(r"(^\s*|[;&|(]\s*|(^|[\s;&|(])(bash|sh|zsh|python3?|exec)\s+(-\S+\s+)*)(\S*/)?(promote|promote_main|stable_install|stable|deploy|deploy_chain|dev_push|ship_dev)\.(sh|py)\b"),
     "call the make front door, not the script: make promote REPO=<repo> BRANCH=<branch>, make stable BOX=<alias>, "
     "make dev-push / ship-dev / loop BOX=<alias> (connector), make widget-push WIDGET=<w> BOX=<alias>"),
    (re.compile(r"\bgit\s+push\b[^;&|]*?(\s|:)(refs/heads/)?main(\s|$|;|&|\|)"),
     "main moves only through make promote REPO=<repo> BRANCH=<branch> (it checks the stamp and CI, then pushes)"),
    (re.compile(r"--no-verify\b"),
     "do not skip git hooks. Fix what the hook refuses; for a slow connector push, the pre-push already leaves shell-heavy tests to CI"),
    (re.compile(r"(^|[\s;&|(])(SKIP_TESTS|ALLOW_UNVERIFIED)=1\b"),
     "these bypass a gate. Run the gate (make promote waits for CI; make stamp-tree NAME=<tree> BOX=<alias> stamps)"),
    (re.compile(r"(\b(for|while|until)\b[^\n]*\bmake\s+(promote|stable)\b)|(\bset\s+--[^\n]*\bmake\s+(promote|stable)\b)", re.S),
     "never loop over make promote / stable in the shell (zsh does not split $var into words: REPO and BRANCH arrived empty). "
     "Use make promote-tree NAME=<tree>, or one make promote per repo"),
]


def check(cmd: str):
    for rx, why in RULES:
        if rx.search(cmd):
            return why
    return None


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if data.get("tool_name") != "Bash":
        return 0
    cmd = (data.get("tool_input") or {}).get("command") or ""
    why = check(cmd)
    if why:
        print(f"Blocked by .claude/hooks/bash_guard.py: {why}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
