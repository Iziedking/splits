#!/usr/bin/env bash
# Proves the adversarial tests can fail: each mutation breaks one safety property of
# SplitsRouter, and the matching test must go red. Runs on a scratch copy, never on src/.
# Usage (from the contracts directory): FORGE=../tools/arc-forge bash scripts/mutation-check.sh
set -euo pipefail

FORGE="${FORGE:-forge}"
SRC=src/SplitsRouter.sol
BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
trap 'cp "$BACKUP" "$SRC"; rm -f "$BACKUP"' EXIT

failures=0

mutate() {
  local name="$1" from="$2" to="$3" test="$4"
  cp "$BACKUP" "$SRC"
  if ! grep -qF -- "$from" "$SRC"; then
    echo "MUTATION $name: pattern not found, check the script"; failures=$((failures + 1)); return
  fi
  python3 - "$SRC" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1:4]
text = open(path).read()
open(path, "w").write(text.replace(old, new, 1))
PY
  if "$FORGE" test --match-test "$test" >/dev/null 2>&1; then
    echo "MUTATION $name: SURVIVED ($test still passes)"; failures=$((failures + 1))
  else
    echo "MUTATION $name: killed by $test"
  fi
}

mutate "no-replay-guard" "refUsed[msg.sender][ref] = true;" "" "test_RevertWhen_RefReused"
mutate "no-reentrancy-guard" "external
        nonReentrant" "external" "test_ReentryFromTokenIsBlocked"
mutate "dust-lost" "amounts[i] = remainder - shared;" "amounts[i] = remainder * legs[i].shareBps / BPS_DENOMINATOR;" "testFuzz_SharesConserveAmount"
mutate "no-owner-check" "if (s.owner != msg.sender) revert NotSplitOwner(splitId, msg.sender);" "" "test_RevertWhen_NonOwnerManagesSplit"
mutate "no-version-check" "if (s.version != expectedVersion)" "if (false)" "test_UpdateSplit_StaleQuoteReverts_NewVersionPaysNewLegs"
mutate "bps-total-unchecked" "if (totalBps != 0 && totalBps != BPS_DENOMINATOR)" "if (false)" "test_RevertWhen_SharesDoNotTotal10000"
mutate "token-as-recipient" "|| r == address(usdc)" "" "test_RevertWhen_RecipientIsZeroRouterOrToken"
mutate "no-cent-rounding" "/ BPS_DENOMINATOR / CENT * CENT;" "/ BPS_DENOMINATOR;" "test_Send_FamilyExampleIsAllCents"
mutate "sub-cent-amount-allowed" "if (amount % CENT != 0) revert AmountNotCents(amount);" "" "test_RevertWhen_AmountNotWholeCents"
mutate "sub-cent-fixed-allowed" "if (legs[i].fixedAmount % CENT != 0)" "if (false)" "test_RevertWhen_FixedAmountNotWholeCents"
mutate "fixed-only-overpay" "if (lastShare == type(uint256).max && remainder != 0)" "if (false)" "test_Send_FixedOnlyNeedsExactTotal"
mutate "pay-wrong-split-id" "emit SplitSent(0, msg.sender, ref, amount, 0);" "emit SplitSent(1, msg.sender, ref, amount, 0);" "test_Pay_EmitsOneOffReceipts"
mutate "pay-skips-validation" "_validate(legs);
        if (amount == 0) revert ZeroAmount();
        _spendRef(ref);" "if (amount == 0) revert ZeroAmount();
        _spendRef(ref);" "test_Pay_RevertWhen_LegInvalid"
mutate "pay-drops-last-leg" "uint256 count = amounts.length;" "uint256 count = amounts.length - 1;" "test_Pay_FixedLegsPayEachWinnerExactly"

if [ "$failures" -ne 0 ]; then
  echo "mutation check: $failures problem(s)"; exit 1
fi
echo "mutation check: all mutations killed"
