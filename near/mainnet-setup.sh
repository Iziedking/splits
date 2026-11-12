#!/usr/bin/env bash
# Puts the splits router on NEAR mainnet for paying from any chain (near/MAINNET.md explains why).
# Run it once from the repository root, after importing your account into near-cli:
#
#   bash near/mainnet-setup.sh            # signs as izie17.tg
#   bash near/mainnet-setup.sh other.near # or any mainnet account you hold
#
# It spends real NEAR (about 2.8). It checks the balance before spending anything, skips any step
# already done, and stops at the first error, so running it again is safe.
set -euo pipefail

OWNER="${1:-izie17.tg}"
ROUTER="splits.$OWNER"
TAX="tax.$OWNER"
SAVINGS="savings.$OWNER"
USDC="17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
RPC="https://free.rpc.fastnear.com"
NET=(network-config mainnet)
SIGN=(sign-with-keychain send)

say() { printf '\n== %s\n' "$*"; }

# view <json params>: one RPC query, printed as JSON (or {"error":...}).
rpc() {
  curl -s "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":$1}"
}
exists() { ! rpc "{\"finality\":\"final\",\"request_type\":\"view_account\",\"account_id\":\"$1\"}" | grep -q '"error"'; }
balance_near() {
  rpc "{\"finality\":\"final\",\"request_type\":\"view_account\",\"account_id\":\"$1\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result;console.log(r?(Number(BigInt(r.amount)/10n**21n)/1000).toFixed(3):"0")})'
}
call_view() { # contract method args-json -> decoded JSON result
  local args; args=$(printf '%s' "$3" | base64 | tr -d '\n')
  rpc "{\"finality\":\"final\",\"request_type\":\"call_function\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$args\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.result?Buffer.from(j.result.result).toString():"null")})'
}
registered() { [ "$(call_view "$USDC" storage_balance_of "{\"account_id\":\"$1\"}")" != "null" ]; }

say "Checking $OWNER"
command -v near >/dev/null || { echo "near-cli is not installed. Install it with: npm i -g near-cli-rs"; exit 1; }
exists "$OWNER" || { echo "$OWNER does not exist on mainnet."; exit 1; }
HAVE=$(balance_near "$OWNER")
echo "$OWNER holds $HAVE NEAR."
if ! exists "$ROUTER"; then
  node -e "process.exit(Number('$HAVE') >= 2.9 ? 0 : 1)" || { echo "It needs about 2.9 NEAR to start. Send NEAR to $OWNER, then run this again."; exit 1; }
fi

say "1. Router code, the same bytes as splits.kingizie.testnet"
node near/proof/fetch-router-wasm.mjs splits_router.wasm

say "2. Router account $ROUTER"
if exists "$ROUTER"; then echo "Already there."; else
  near account create-account fund-myself "$ROUTER" '2.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as "$OWNER" "${NET[@]}" "${SIGN[@]}"
fi

say "3. Deploy, accepting only Circle's USDC"
if [ "$(call_view "$ROUTER" tokens '{}')" = "[\"$USDC\"]" ]; then echo "Already deployed."; else
  near contract deploy "$ROUTER" use-file splits_router.wasm with-init-call new json-args "{\"tokens\":[\"$USDC\"]}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' "${NET[@]}" "${SIGN[@]}"
fi

say "4. Tax and savings accounts"
for a in "$TAX" "$SAVINGS"; do
  if exists "$a"; then echo "$a already there."; else
    near account create-account fund-myself "$a" '0.1 NEAR' autogenerate-new-keypair save-to-keychain sign-as "$OWNER" "${NET[@]}" "${SIGN[@]}"
  fi
done

say "5. Let the router and every part hold USDC"
for a in "$ROUTER" "$TAX" "$SAVINGS" "$OWNER"; do
  if registered "$a"; then echo "$a can already hold USDC."; else
    near account manage-storage-deposit "$USDC" deposit "$a" '0.00125 NEAR' sign-as "$OWNER" "${NET[@]}" "${SIGN[@]}"
  fi
done

say "6. Save the split: 30% tax, 20% savings, 50% spending"
if [ "$(call_view "$ROUTER" get_split "{\"account_id\":\"$OWNER\"}")" != "null" ]; then echo "A split is already saved."; else
  near contract call-function as-transaction "$ROUTER" set_split json-args "{\"shares\":[{\"account_id\":\"$TAX\",\"bps\":3000,\"purpose\":\"tax\"},{\"account_id\":\"$SAVINGS\",\"bps\":2000,\"purpose\":\"savings\"},{\"account_id\":\"$OWNER\",\"bps\":5000,\"purpose\":\"spending\"}]}" prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' sign-as "$OWNER" "${NET[@]}" "${SIGN[@]}"
fi

say "Done"
echo "Saved split: $(call_view "$ROUTER" get_split "{\"account_id\":\"$OWNER\"}")"
echo "Router:      https://nearblocks.io/address/$ROUTER"
echo "Next: add NEAR_CHECKOUT_ROUTER=$ROUTER to /opt/splits/prod.env on host-services."
rm -f splits_router.wasm
