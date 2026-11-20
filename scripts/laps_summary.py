"""Lap ledger rows on stdin (ts, label, secs, rc, budget, repo) -> one line per step."""
import statistics
import sys

rows = {}
for line in sys.stdin:
    p = line.rstrip("\n").split("\t")
    if len(p) >= 5 and p[2].isdigit():
        rows.setdefault(p[1], []).append((int(p[2]), p[4]))
print("%-28s %4s %6s %6s %6s %6s %4s" % ("step", "runs", "last", "median", "max", "budget", "over"))
for label, runs in sorted(rows.items()):
    secs = [s for s, _ in runs]
    budget = runs[-1][1]
    over = sum(1 for s, b in runs if b != "-" and s > int(b))
    print("%-28s %4d %5ds %5ds %5ds %6s %4d" % (label, len(secs), secs[-1], int(statistics.median(secs)),
                                               max(secs), budget + "s" if budget != "-" else "-", over))
