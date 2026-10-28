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
mutate_in "deposit-attesting-forever" src/server/services/deposits.ts   '      if (receipt === "reverted" || stillHere) {' '      if (false) {'   src/server/services/deposits.test.ts "burns again when the first burn never stuck"
mutate_in "deposit-reburns-on-missing-receipt" src/server/services/deposits.ts   '      const stillHere = receipt === null && (await' '      const stillHere = receipt === null || (await'   src/server/services/deposits.test.ts "never burns again when one node"
mutate_in "deposit-move-never-ends" src/server/services/deposits.ts   '  if (attempts < MAX_ATTEMPTS) return save(' '  if (true) return save('   src/server/services/deposits.test.ts "ends a move that keeps failing"
mutate_in "wild-height-trusted" src/server/chain/freshness.ts   '  const top = Math.max(...(agreed.length ? agreed : known));' '  const top = Math.max(...known);'   src/server/chain/freshness.test.ts "wild height"
mutate_in "other-chain-rpc-used" src/server/chain/freshness.ts   '  const ours = (list: string[]) => list.filter((url) => onChain[urls.indexOf(url)]);' '  const ours = (list: string[]) => list;'   src/server/chain/freshness.test.ts "another chain"
mutate_in "lease-cleared-unfenced" src/server/services/transfers.ts   '.where(and(eq(transfers.id, transferId), eq(transfers.leaseUntil, leased.leaseUntil!)));'   '.where(eq(transfers.id, transferId));'   src/server/services/flow.test.ts "leaves the next worker's lease alone"
mutate_in "earn-confirms-side-by-side" src/server/services/earn.ts   'eq(earnMoves.status, "awaiting_confirmation"), notExists(other))'   'eq(earnMoves.status, "awaiting_confirmation"))'   src/server/services/earn.test.ts "one of two moves drafted side by side"
mutate_in "new-wallets-uncapped" src/server/services/users.ts   '  if (!allowed) return null;' ''   src/server/services/payouts.test.ts "caps the new wallets"
mutate_in "payment-notified-on-every-advance" src/server/services/rules.ts   '  if (t.status !== before) await notifyPaymentOutcome(ctx, t);' '  await notifyPaymentOutcome(ctx, t);'   src/server/services/flow.test.ts "tells nobody again when an old payment is opened later"
mutate_in "cleared-notifications-reappear" src/server/services/notifications.ts   '    .where(and(eq(notifications.userId, userId), isNull(notifications.clearedAt)))
    .orderBy(desc(notifications.createdAt))' '    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))'   src/server/services/notifications.test.ts "clears the feed for good"
mutate_in "unlisted-balance-ignored" src/server/services/deposits.ts   '      if (await recordUnlisted(ctx, w)) found++;' ''   src/server/services/deposits.test.ts "moves a deposit sent to someone who never opened Receive"
mutate_in "unlisted-no-grace" src/server/services/deposits.ts   '  if (since === undefined || now - since < UNLISTED_GRACE_MS) return false;' '  if (false) return false;'   src/server/services/deposits.test.ts "waits before trusting a balance"
mutate_in "unlisted-counted-twice" src/server/services/deposits.ts   '    const left = BigInt(u.amount) - seen.amount;' '    const left = -1n;'   src/server/services/deposits.test.ts "counts a deposit once when Circle reports it after"
mutate_in "deposit-skips-automatic-split" src/server/services/deposits.ts   '  if (row?.mintTxHash && main) await createAutoTransfer(ctx, main, minted, inboundKey(row.mintTxHash));' ''   src/server/services/flow.test.ts "runs the person's rule on a deposit once it lands"
mutate_in "stale-node-trusted" src/server/chain/freshness.ts   '  const current = (i: number) => heights[i] !== null && Math.abs(top - heights[i]!) <= maxLag;' '  const current = (_i: number) => true;'   src/server/chain/freshness.test.ts "moves a node that has fallen behind"
mutate_in "partial-split-last-takes-rest" src/server/domain/allocation.ts   '    if (i === lastShare && whole) return remainder - shared;' '    if (i === lastShare) return remainder - shared;'   src/server/domain/domain.test.ts "give each person exactly their percentage"
mutate_in "rule-allows-partial-shares" src/server/services/splits.ts   '{ partialShares: !input.autoForWalletId }' '{ partialShares: true }'   src/server/services/flow.test.ts "still requires 100% for an automatic split"
mutate_in "wallet-close-hangs" src/lib/wallet/flow.ts   '      finish(() => (account ? resolve(account) : reject(new Error("closed"))));' '      if (!account) finish(() => reject(new Error("closed")));'   src/lib/wallet/flow.test.ts "uses a wallet that reconnected"
mutate_in "earn-withdraws-again" src/server/services/earn.ts   '    const short = wanted > idle ? wanted - idle : 0n;' '    const short = wanted;'   src/server/services/earn.test.ts "never withdraws twice"
mutate_in "earn-deposits-while-leaving" src/server/services/earn.ts   '  if (leaving) return null;' ''   src/server/services/earn.test.ts "leaves the pocket alone"
mutate_in "earn-moves-without-pin" src/server/services/earn.ts   '  if (!(ACTIVE as readonly string[]).includes(move.status)) return move;' '  if (move.status === "done") return move;'   src/server/services/earn.test.ts "moves money in only after the PIN"
mutate_in "earn-retry-ignores-pending-withdraw" src/server/services/earn.ts   '      if (sent && !landed && ctx.now().getTime() - move.withdrawAt!.getTime() < WITHDRAW_PENDING_MS) return move;' ''   src/server/services/earn.test.ts "never withdraws again while a timed-out withdrawal may still land"
C=src/server/services/crossPay.ts
CT=src/server/services/crossPay.test.ts
mutate_in "cross-skips-burn-check" "$C"   '    if (!receipt.burns.some((b) => checkBurn(b, want) === "ok")) {'   '    if (false) {'   "$CT" "refuses a burn whose hook doesn't match the draft"
mutate_in "cross-trusts-any-amount" "$C"   '    burn.amount >= want.burnAmount &&'   '    true &&'   "$CT" "refuses a burn for less than the draft"
mutate_in "cross-settles-before-crosspaid" "$C"   '  if (await ctx.chain.cctpNonceUsed(ctx.crossChain.cctp.messageTransmitter, cp.nonce as Hex)) return "wait";'   '  if (await ctx.chain.cctpNonceUsed(ctx.crossChain.cctp.messageTransmitter, cp.nonce as Hex)) return { status: "settled" };'   "$CT" "waits for SplitsCrossPay's events after the mint"
mutate_in "cross-allows-disabled-chain" "$C"   '  if (chain) return chain;'   '  if (chain || key in SOURCE_CHAINS) return chain ?? SOURCE_CHAINS[key as ChainKey];'   "$CT" "refuses a chain that isn't switched on"
mutate_in "cross-verify-raw-ref" src/server/services/transfers.ts   '  return { payer: ctx.crossPay!.address, ref: routerRefFor(chain.domain, t.payerAddress as Address, t.ref as Hex) };'   '  return { payer: ctx.crossPay!.address, ref: t.ref as Hex };'   "$CT" "pays every recipient exactly"
mutate_in "cross-outcome-any-message" src/server/preview/previewArc.ts   '      const e = this.crossEvents.find((x) => x.nonce === nonce.toLowerCase());'   '      const e = this.crossEvents[0];'   "$CT" "copies this payment's ref and payer"
mutate_in "cross-outcome-first-mint" src/server/chain/viemChain.ts   '  const mine = mints.find((l) => same(l.args.nonce, nonce));'   '  const mine = mints[0];'   src/server/chain/outcome.test.ts "ignores events with this payment's ref and payer"
mutate_in "iris-first-burn" src/server/crosschain/iris.ts   'const candidates = matches ? all.filter((m) => !done(m) || matches(m.message)) : all.slice(0, 1);'   'const candidates = all.slice(0, 1);'   src/server/crosschain/crosschain.test.ts "picks this payment's burn"
R=src/server/crosschain/reader.ts
RT=src/server/crosschain/sources.test.ts
mutate_in "burns-no-narrowing" "$R"   '      range = Math.max(MIN_LOG_RANGE, Math.floor(range / 2));'   '      throw err;'   "$RT" "fewer blocks a call than the chain table"
mutate_in "burns-skip-recent" "$R"   '  const recent = await searchBurns(chain, depositor, scan.to + 1n > fromBlock ? scan.to + 1n : fromBlock, latest);'   '  const recent: FoundBurn[] = [];'   "$RT" "fewer blocks a call than the chain table"
mutate_in "burns-rescan-everything" "$R"   '  const scan = kept && kept.from <= fromBlock ? kept :'   '  const scan = kept && false ? kept :'   "$RT" "only the blocks since the last search"
mutate_in "burns-keeps-earlier" "$R"   '.filter((b) => b.block >= fromBlock)'   ''   "$RT" "leaves out burns before the block asked from"
mutate_in "burns-narrows-on-outage" "$R"   'return /range|too large|more than/i.test(text);'   'return true;'   "$RT" "instead of narrowing the search forever"
mutate_in "burns-rate-limit-narrows" "$R"   'return /range|too large|more than/i.test(text);'   'return /range|too large|more than|limit/i.test(text);'   "$RT" "tells a range refusal from a rate limit"
# Audit 2026-10-28: sign-in, passkeys, rules and failed sends.
mutate_in "otp-guess-not-reserved" src/server/auth/otp.ts   ', lt(otpCodes.attempts, MAX_ATTEMPTS)))'   '))'   src/server/auth/auth.test.ts "parallel guesses"
mutate_in "passkey-without-pin" src/server/auth/passkeys.ts   '  await verifyPin(db, user.id, pin, now);'   ''   src/server/auth/auth.test.ts "needs the PIN, so a stolen session"
mutate_in "rule-keyed-by-payment" src/server/services/rules.ts   'parent.txHash ? inboundKey(parent.txHash) : parent.id'   'parent.id'   src/server/services/flow.test.ts "webhook for the same money comes first"
mutate_in "rule-legacy-key-ignored" src/server/services/rules.ts   '    const id = legacy?.id ?? (await'   '    const id = (await'   src/server/services/flow.test.ts "keyed by the payment's id"
mutate_in "rule-pays-anyone" src/server/services/splits.ts   '      if (leg.to.type !== "wallet") throw'   '      if (false) throw'   src/server/services/flow.test.ts "only between the owner's own wallets"
mutate_in "webhook-rule-on-own-money" src/server/services/webhooks.ts   '  if (await fromSplits(ctx, tx.data.sourceAddress)) return "ignored";'   ''   src/server/services/webhooks.test.ts "starts no rule for money from the treasury"
mutate_in "failed-send-trusts-provider" "$T"   '        if (sent?.status === "success") return { status: "verifying", patch: { txHash: row.txHash } };'   ''   src/server/services/flow.test.ts "settles when Arc shows it landed"
mutate_in "ref-read-at-head" "$T"   'on.ref, receipt.blockNumber)'   'on.ref)'   src/server/services/flow.test.ts "settles when Arc shows it landed"
mutate_in "confirm-any-route" src/server/services/actions.ts   '  if (action.type !== type) throw badRequest("WRONG_ACTION", wrongType);'   ''   src/server/services/flow.test.ts "sent to the wrong route"
if [ "$failures" -ne 0 ]; then echo "mutation check: $failures problem(s)"; exit 1; fi
echo "mutation check: all mutations killed"
