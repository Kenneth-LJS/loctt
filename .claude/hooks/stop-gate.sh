#!/bin/bash
# Stop gate — blocks stopping "out of nowhere".
#
# The workflow already names every legitimate reason to stop. This does
# not re-derive them; it asks one question: WAS A REASON DECLARED?
#
# Declaring means writing .claude/STOPPING with a reason. The file is
# consumed on read, so a reason covers exactly one stop and cannot be
# left behind to authorise the next.
#
# Exit 0 -> allowed. Exit 2 -> stderr returns to the model, turn continues.

cd "$(dirname "$0")/../.." || exit 0
DECL=".claude/STOPPING"
STAMP=".claude/.stop-gate-progress"

# 1. A declared reason. One stop, then gone.
if [ -f "$DECL" ]; then
  rm -f "$DECL"
  exit 0
fi

# 2. Work in flight — but only if it is ADVANCING.
#
# "A suite is running" is not enough: a hung suite would excuse
# stopping forever, which is the failure this gate exists to prevent
# turned inside out. So compare a progress fingerprint against the last
# turn's. If nothing moved, the wait is not productive and the model is
# told to investigate rather than wait again.
if pgrep -f "playwright test|vitest run|npm run test|npm run build" >/dev/null 2>&1; then
  # **Accumulated CPU time of the running test processes.**
  #
  # Log bytes were the first instrument and they were wrong: a
  # background run's output is buffered until it exits, so its log sits
  # at 0 bytes for ten minutes while the suite works perfectly. The
  # gate fired on a suite 49 seconds into a clean run.
  #
  # CPU time cannot be fooled that way. A process doing work
  # accumulates it; a hung one does not. It is also indifferent to
  # *where* the output goes, which is what the log-bytes version got
  # wrong.
  now=$(
    { ps -o time= -p "$(pgrep -f 'playwright test|vitest run|npm run' \
        2>/dev/null | tr '\n' ',' | sed 's/,$//')" 2>/dev/null;
      pgrep -f "playwright test|vitest run" 2>/dev/null | wc -l; } | tr -d ' \n'
  )
  prev=$(cat "$STAMP" 2>/dev/null)
  printf '%s' "$now" > "$STAMP"
  if [ "$now" != "$prev" ]; then
    exit 0   # advancing — waiting is legitimate
  fi
  cat >&2 <<'HUNG'
STOP GATE: work is running but has not advanced since your last turn.

A process is alive and its output has not moved. That is a hang, not a
wait — and waiting again will not fix it.

Check it: `uptime` for load, and the suite's own log for its last line
and timestamp. If it is genuinely stuck, kill it and say so. If it is
advancing and this fired wrongly, declare the wait:

    echo "waiting on <what>, last progress <when>" > .claude/STOPPING
HUNG
  exit 2
fi

rm -f "$STAMP"
cat >&2 <<'MSG'
STOP GATE: no reason was declared.

The workflow names every legitimate reason to stop. Stopping to report
progress mid-ticket is not one of them — that is the pattern this gate
exists to catch.

If you are genuinely stopping, say why:

    echo "<reason>" > .claude/STOPPING

Valid reasons are the four stop conditions in TEMP-RUN-WORKFLOW.md:
  1. it changes scope
  2. it invents a requirement
  3. it violates a P-principle or a recorded decision
  4. it is load-bearing

...or: a question only Ken can answer, or the ticket is complete and
committed.

Otherwise: continue. The next step is in TEMP-BUILD-PLAN.md's Status
table and TEMP-RUN-WORKFLOW.md's subsection loop.
MSG
exit 2
