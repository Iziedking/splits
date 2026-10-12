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
  'if ((parent.kind !== "send" && parent.kind !== "pay") || parent.status !== "settled") return [];' \
  'if (parent.status !== "settled") return [];' \
  "never triggers another"

# Same as mutate, for safeguards whose tests live outside flow.test.ts.
mutate_in() {
  local name="$1" file="$2" from="$3" to="$4" testfile="$5" test="$6"
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
  if npx vitest run "$testfile" -t "$test" >/dev/null 2>&1; then
    echo "MUTATION $name: SURVIVED ($test still passes)"; failures=$((failures + 1))
  else
    echo "MUTATION $name: killed by \"$test\""
  fi
  cp "$backup" "$file"
  rm -f "$backup"
}

P=src/server/services/payouts.ts
mutate_in "no-duplicate-check" "$P" \
  'if (seen.has(key)) flag(l, "duplicate", MESSAGES.duplicate);' '' \
  src/server/services/payouts.test.ts "flags bad, duplicate"
mutate_in "no-receive-probe" "$P" \
  'if (!(await ctx.chain.canReceive(ctx.treasuryAddress, l.address))) flag(' 'if (false) flag(' \
  src/server/services/payouts.test.ts "flags bad, duplicate"
mutate_in "probe-error-blames-recipient" "$P" \
  'flag(l, "check_failed", MESSAGES.check_failed);' 'flag(l, "cant_receive", MESSAGES.cant_receive);' \
  src/server/services/payouts.test.ts "couldn't be checked"
mutate_in "no-resolved-duplicate-check" "$P" \
  'else if (paid.has(key)) flag(l, "duplicate", MESSAGES.duplicate);' '' \
  src/server/services/payouts.test.ts "same person named by email and by address"
mutate_in "loose-email-check" src/server/domain/payouts.ts \
  'if (isValidEmail(who.toLowerCase()))' 'if (who.includes("."))' \
  src/server/domain/payouts.test.ts "sign-in would refuse"
mutate_in "no-checksum-check" src/server/domain/payouts.ts \
  'if (checksumOk(who))' 'if (true)' \
  src/server/domain/payouts.test.ts "mistyped checksummed"
mutate_in "draft-hash-unchecked" "$P" \
  'if (draft.hash !== hash || draft.expiresAt <= ctx.now())' 'if (draft.expiresAt <= ctx.now())' \
  src/server/services/payouts.test.ts "only lets the owner"
mutate_in "equal-pot-leftover-lost" src/server/domain/payouts.ts \
  '(base + (i < extra ? 1n : 0n)) * CENT' 'base * CENT' \
  src/server/domain/payouts.test.ts "always sums to the pot"
mutate "draft-paid-twice" "$T" \
  'if (draft && !(await consumeDraft(ctx, draft.id, id))) {' 'if (false) {' \
  "creates exactly one payment"
mutate "notice-to-payer" src/server/services/notices.ts \
  '.filter((l) => l.email && l.email !== payer?.email && BigInt(l.amount) > 0n)' '.filter((l) => l.email && BigInt(l.amount) > 0n)' \
  "never sends a notice to the payer"
mutate "receipt-shows-total" src/server/views.ts   '    network: ctx.network,' '    network: ctx.network, total: formatUsdc(BigInt(t.amount)),'   "shows only their part"
mutate "receipt-before-settled" src/server/services/receipts.ts   '  if (t.status !== "settled") return null;' ''   "has no links before the payment settles"

mutate_in "no-send-limit" src/server/services/sendLimits.ts \
  '    if (used + amount > daily) {' '    if (false) {' \
  src/server/services/sendLimits.test.ts "counts a rolling 24 hours"
mutate_in "reservations-not-counted" src/server/services/sendLimits.ts \
  '? or(inArray(transfers.status, COUNTED), and(eq(transfers.status, "awaiting_wallet"), gt(transfers.expiresAt, now)))' '? inArray(transfers.status, COUNTED)' \
  src/server/services/sendLimits.test.ts "counts a rolling 24 hours"
mutate_in "payer-not-checked" src/server/services/transfers.ts \
  '    sent &&' '    true &&' \
  src/server/services/visitorPayments.test.ts "another wallet's hash was submitted"
mutate_in "fee-leg-not-verified" "$T" \
  '  if (BigInt(t.feeAmount) > 0n) {' '  if (false) {' \
  src/server/services/visitorPayments.test.ts "leaves the fee out"
mutate_in "fee-tier-ignored" src/server/domain/fees.ts \
  'const bps = recipients >= rule.manyFrom ? rule.manyBps : rule.bps;' 'const bps = rule.bps;' \
  src/server/domain/fees.test.ts "uses the many-people rate"
mutate "fee-from-env-not-stored" "$T" \
  'export const chargeOf = (t: Pick<Transfer, "amount" | "feeAmount">) => BigInt(t.amount) + BigInt(t.feeAmount);' 'export const chargeOf = (t: Pick<Transfer, "amount" | "feeAmount">) => BigInt(t.amount) + (BigInt(t.amount) * 900n) / 10_000n;' \
  "keeps the quoted fee"
mutate_in "visitor-key-unchecked" src/server/services/payouts.ts \
  'isVisitor(owner) ? draft?.visitorKeyHash === owner.visitorKeyHash' 'isVisitor(owner) ? true' \
  src/server/services/payouts.test.ts "only that visitor can use it"
mutate_in "no-receipt-check" "$T" \
  '  if (receipt.status !== "success") return false;' '  return receipt.status === "success";' \
  src/server/services/visitorPayments.test.ts "fails a payment whose legs differ"
mutate_in "no-draft-cap" src/server/services/agentDrafts.ts   '  if (!perAccount) {' '  if (false) {'   src/server/services/agentDrafts.test.ts "stops at the daily cap"
mutate_in "image-type-unchecked" src/server/agent/images.ts   '    if (!format) {' '    if (false) {'   src/server/agent/images.test.ts "refuses a file that isn't an image"
mutate_in "schema-unchecked" src/server/services/agentDrafts.ts   '    const parsed = agentDraftSchema.safeParse(result.output);' '    const parsed = { success: true as const, data: result.output as AgentDraft };'   src/server/services/agentDrafts.test.ts "tries once more when the answer has the wrong shape"
mutate_in "deposit-not-verified" src/server/services/deposits.ts   '  if (!seen.ok) {' '  if (false) {'   src/server/services/deposits.test.ts "ignores a report that the chain doesn't back up"
mutate_in "deposit-random-keys" src/server/services/deposits.ts 'const key = (move: Move, step: string) => deterministicUuid(`deposit-move:${move.id}:${step}:${move.attempts}`);' 'const key = (_move: Move, _step: string) => crypto.randomUUID();' src/server/services/deposits.test.ts "resumes after a crash between sending the burn and saving it"
mutate_in "deposit-ignores-used-nonce" src/server/services/deposits.ts   '    if (!(await ctx.chain.cctpNonceUsed(cctp.messageTransmitter, move.nonce as Hex))) {
      if (minted.status === "failed")' '    if (false) {
      if (minted.status === "failed")'   src/server/services/deposits.test.ts "never calls a deposit ready when its mint failed"
mutate_in "deposit-mints-for-anyone" src/server/services/deposits.ts   '    if (parsed.mintRecipient.toLowerCase() !== recipient.toLowerCase() || parsed.amount !== amount || parsed.sourceDomain !== chain.domain) {' '    if (false) {'   src/server/services/deposits.test.ts "never mints a message addressed to someone else"
mutate_in "deposit-waiting-holds-slots" src/server/services/deposits.ts   '    .where(eq(deposits.status, "detected"))' '    .where(inArray(deposits.status, ["detected", "waiting"]))'   src/server/services/deposits.test.ts "never lets deposits that wait for more hold up anyone else"
mutate_in "deposit-no-backoff" src/server/services/deposits.ts   '      eq(depositMoves.attempts, 0),' '      sql`true`,'   src/server/services/deposits.test.ts "backs off a step that keeps failing"
mutate_in "deposit-attesting-forever" src/server/services/deposits.ts   '      if (receipt !== "success") {' '      if (false) {'   src/server/services/deposits.test.ts "burns again when the first burn never stuck"
mutate_in "payment-notified-on-every-advance" src/server/services/rules.ts   '  if (t.status !== before) await notifyPaymentOutcome(ctx, t);' '  await notifyPaymentOutcome(ctx, t);'   src/server/services/flow.test.ts "tells nobody again when an old payment is opened later"
mutate_in "cleared-notifications-reappear" src/server/services/notifications.ts   '    .where(and(eq(notifications.userId, userId), isNull(notifications.clearedAt)))
    .orderBy(desc(notifications.createdAt))' '    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))'   src/server/services/notifications.test.ts "clears the feed for good"
if [ "$failures" -ne 0 ]; then echo "mutation check: $failures problem(s)"; exit 1; fi
echo "mutation check: all mutations killed"
