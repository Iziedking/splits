#!/usr/bin/env bash
# Proves the money-path tests can fail: each mutation removes one safeguard and the named test
# must go red. Files are restored afterwards. Run from web/: bash scripts/mutation-check.sh
set -euo pipefail

failures=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4" test="$5"
  local backup
  backup="$(mktemp)"
  cp "$file" "$backup"
  if ! grep -qF -- "$from" "$file"; then
    echo "MUTATION $name: pattern not found"; failures=$((failures + 1)); rm -f "$backup"; return
  fi
  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1:4]
text = open(path).read()
open(path, "w").write(text.replace(old, new, 1))
PY
  if npx vitest run src/server/services/flow.test.ts -t "$test" >/dev/null 2>&1; then
    echo "MUTATION $name: SURVIVED ($test still passes)"; failures=$((failures + 1))
  else
    echo "MUTATION $name: killed by \"$test\""
  fi
  cp "$backup" "$file"
  rm -f "$backup"
}

T=src/server/services/transfers.ts
mutate "random-idempotency-key" src/server/services/providerTx.ts \
  'const idempotencyKey = deterministicUuid(`${subjectId}:${step}:${attempt}`);' \
  'const idempotencyKey = crypto.randomUUID();' \
  "not sent twice"
mutate "no-receipt-check" "$T" \
  'if (!matches || !(await ctx.chain.refUsed(payer.address, t.ref as Hex))) {' \
  'if (false) {' \
  "doesn't match what the user approved"
mutate "no-user-daily-cap" "$T" \
  "if (userTotal > ctx.limits.perUserDaily) {" \
  "if (false) {" \
  "per-user daily cap"
mutate "no-lease" "$T" \
  "or(isNull(transfers.leaseUntil), lt(transfers.leaseUntil, now))," \
  "" \
  "exactly once"
mutate "pin-not-reserved" src/server/auth/pin.ts \
  'sql`${users.pinFailures} < ${MAX_FAILURES}`,' \
  'sql`true`,' \
  "five wrong PINs"
mutate "auto-loop-guard" src/server/services/rules.ts \
  'if (parent.kind !== "send" || parent.status !== "settled") return [];' \
  'if (parent.status !== "settled") return [];' \
  "never triggers another"

if [ "$failures" -ne 0 ]; then echo "mutation check: $failures problem(s)"; exit 1; fi
echo "mutation check: all mutations killed"
