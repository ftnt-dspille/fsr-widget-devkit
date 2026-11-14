#!/usr/bin/env bash
# Time one push step: `lap.sh <label> -- <cmd...>` runs cmd and prints "   [Ns] <label>"
# (or "   [Ns] <label> FAILED"), keeping cmd's exit status. Used by widget-push.
label="$1"; shift; [[ "${1:-}" == "--" ]] && shift
t0=$SECONDS
"$@"; rc=$?
echo "   [$((SECONDS - t0))s] $label$([[ $rc -ne 0 ]] && echo " FAILED")"
exit $rc
