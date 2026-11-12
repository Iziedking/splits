# Split Checkout on NEAR mainnet

Paying a split from another chain uses NEAR Intents, which has no testnet. So it needs the splits router on NEAR mainnet. It is the same code as `splits.kingizie.testnet`, byte for byte. These are the owner's steps. They spend real NEAR and USDC, so use small amounts.

The flow, once it is on:

1. The payer opens `near.mysplits.xyz/near/checkout/<account>`, enters the amount the account receives, picks a coin and chain (USDC on Base, ETH, SOL, USDT on Tron and so on), and gives a refund address on that chain.
2. The server checks NEAR mainnet: the account has a saved split, and the router and every account in the split can hold USDC. Only then does it ask NEAR Intents' 1Click API for a deposit address. It asks for `EXACT_OUTPUT` of USDC, `recipient` = the router, and `customRecipientMsg` = `{"ref","to","version"}`.
3. The payer sends the coin. 1Click converts it and withdraws exactly that USDC to the router with `ft_transfer_call` carrying the message. The router divides it by the saved split as it arrives, as it does for any NEAR payer.

Why this way: 1Click can pass a message to `ft_transfer_call` when it delivers on NEAR (`customRecipientMsg` in its OpenAPI, marked experimental). So the delivery itself carries the split, and the router needed no change and no backend. 1Click warns that funds are lost if the receiver cannot take the call. That is why the server refuses to issue a deposit address unless the router and every recipient are registered for USDC storage.

Every Intents delivery reaches the router from the same sender. If the router refuses a delivery or a part (a split changed in the minutes between quote and arrival, say), that USDC goes back to the Intents contract, not straight to the payer's wallet. The checks above make this unlikely. It is still why checkout is capped at 1,000 USDC for now.

## Steps

You need near-cli-rs (`near --version`, v0.14 or newer) and a mainnet account with about 3 NEAR whose key is in your keychain. A HOT wallet account such as `izie17.tg` can be imported with its seed phrase (`near account import-account using-seed-phrase ...`). Any other mainnet account also works. Below, `izie17.tg` signs and the router is `splits.izie17.tg`.

```bash
# 1. The exact router code from testnet, checked against NEAR's hash
node near/proof/fetch-router-wasm.mjs splits_router.wasm

# 2. The router account (the code is ~197 KB, so it needs about 2 NEAR for storage)
near account create-account fund-myself splits.izie17.tg '2.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as izie17.tg network-config mainnet sign-with-keychain send

# 3. Deploy and allow only Circle's USDC on NEAR
near contract deploy splits.izie17.tg use-file splits_router.wasm with-init-call new json-args '{"tokens":["17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"]}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send

# 4. Let the router hold USDC
near account manage-storage-deposit 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 deposit splits.izie17.tg '0.00125 NEAR' sign-as izie17.tg network-config mainnet sign-with-keychain send

# 5. Check it
near contract call-function as-read-only splits.izie17.tg tokens empty-args network-config mainnet now
```

Then save a split to be paid, from the account that receives. For example, the lead case "auto-split my income into tax, savings and spending":

```bash
near contract call-function as-transaction splits.izie17.tg set_split json-args '{"shares":[{"account_id":"tax.izie17.tg","bps":3000,"purpose":"tax"},{"account_id":"savings.izie17.tg","bps":2000,"purpose":"savings"},{"account_id":"izie17.tg","bps":5000,"purpose":"spending"}]}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as izie17.tg network-config mainnet sign-with-keychain send
```

Every account in the split must hold USDC already. Register any that do not, once each:

```bash
near account manage-storage-deposit 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 deposit tax.izie17.tg '0.00125 NEAR' sign-as izie17.tg network-config mainnet sign-with-keychain send
```

## Turn it on

On host-services, add one line to `/opt/splits/prod.env` and restart the app. No rebuild is needed: the server reads it at run time.

```
NEAR_CHECKOUT_ROUTER=splits.izie17.tg
```

`ONECLICK_JWT` is optional. Without it 1Click adds 0.25% to each quote. Keys come from partners.near-intents.org.

Then open `https://near.mysplits.xyz/near/checkout/izie17.tg`, ask a price for 0.10 USDC, and pay it from a wallet on another chain. The pay link page for the account also shows "Pay from another chain instead".

## Before submission

Delete the router's full-access key, as for testnet, so nobody can change its code:

```bash
near account view-account-summary splits.izie17.tg network-config mainnet now
near account delete-keys splits.izie17.tg public-keys ed25519:<the key listed> network-config mainnet sign-with-keychain send
```
