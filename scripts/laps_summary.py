"""Lap ledger rows on stdin (ts, label, secs, rc, budget, repo) -> one line per step."""
import re
import statistics
import sys

rows = {}
failures = []
misuse = {}
for line in sys.stdin:
    p = line.rstrip("\n").split("\t")
    if len(p) >= 5 and p[2].isdigit():
        rows.setdefault(p[1], []).append((int(p[2]), p[4]))
        if len(p) >= 7 and p[3] != "0" and p[6] != "-":
            failures.append((p[0], p[1], p[3], p[6]))
            try:
                text = open(p[6]).read()
            except OSError:
                text = ""
            # A target called wrong (usage line, unknown variable): an agent
            # error, not a failing gate. Counted per step to show which front
            # door keeps being misused.
            if re.search(r"\busage:|unknown variable", text):
                misuse[p[1]] = misuse.get(p[1], 0) + 1
print("%-28s %4s %6s %6s %6s %6s %4s" % ("step", "runs", "last", "median", "max", "budget", "over"))
for label, runs in sorted(rows.items()):
    secs = [s for s, _ in runs]
    budget = runs[-1][1]
    over = sum(1 for s, b in runs if b != "-" and s > int(b))
    print("%-28s %4d %5ds %5ds %5ds %6s %4d" % (label, len(secs), secs[-1], int(statistics.median(secs)),
                                               max(secs), budget + "s" if budget != "-" else "-", over))
if misuse:
    print("\ncalled wrong (usage / unknown variable), per step: " + ", ".join("%s %d" % kv for kv in sorted(misuse.items())))
if failures:
    print("\nrecent failures (last 20 lines of each are kept):")
    for ts, label, rc, log in failures[-5:]:
        try:
            last = [l for l in open(log).read().splitlines() if l.strip()][-1][:120]
        except (OSError, IndexError):
            last = "(log missing)"
        print("  %s %s rc=%s  %s\n      %s" % (ts, label, rc, last, log))
