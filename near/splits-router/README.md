# splits-router (NEAR)

One stablecoin payment, divided between named NEAR accounts, with a purpose on every part. An
account can also save its own split ("auto-split my income into tax, savings and spending"), and
every payment sent to it through the router divides itself on arrival, with no backend involved.

Built for the NEAR hackathon (window 2026-11-01 to 2026-11-14). The rest of this repository is
Splits on Arc and predates the hackathon.

## How it works

1. The payer calls `ft_transfer_call` on an allowed token with this contract as `receiver_id`, and a
   JSON `msg`:
   - listed parts: `{"ref":"inv-42","legs":[{"account_id":"ada.testnet","amount":"5000000","purpose":"rent"}, ...]}`
     (the amounts must add up to the amount sent), or
   - a saved split: `{"ref":"inv-43","to":"ada.testnet","version":1}` (the version the payer was shown).
2. `ft_on_transfer` checks the message. If anything is wrong, the whole amount is returned as unused
   and the token refunds the payer. Reasons are logged as a `payment_refused` event:
   `token_not_allowed`, `amount_too_small`, `bad_msg`, `no_legs`, `too_many_legs`, `zero_amount`,
   `bad_purpose`, `duplicate_recipient`, `legs_do_not_add_up`, `no_saved_split`,
   `stale_split_version`, `bad_ref`, `router_cannot_be_recipient`, `not_enough_gas`,
   `ref_already_used`.
3. Otherwise each part goes out with `ft_transfer`. `on_payout` reads every result and returns the
   total that did not land, so the token refunds exactly those parts to the payer.
4. Events (NEP-297, standard `splits`): `leg_paid`, `leg_refunded`, `payment`, `payment_refused`,
   `split_saved`. These are the receipts.

`set_split(shares)` saves the caller's split: shares in basis points totalling 10,000, a purpose on
each. The caller pays the storage it uses (attach 0.01 NEAR or more; the rest comes back). Each save
increases the version.

Division is in the token's smallest unit. Each part gets `floor(amount × bps / 10000)` and the units
left over go one at a time to the parts in saved order, the same rule as Splits on Arc.

## Limits, stated plainly

- **Not atomic across parts.** NEAR contracts call each other asynchronously. One part can land while
  another is refunded (for example, a recipient not registered with the token). The events say which.
  On Arc, one transaction pays everyone or nobody.
- **The router holds the money for a few blocks** between receiving it and paying it out. On Arc the
  router never holds funds.
- At most 10 parts per payment (gas). Larger payrolls are sent as several payments.
- Smallest payment: 10,000 units (0.01 of a 6-decimal stablecoin), so stored references can't be spammed with dust.
- Recipients must be registered with the token before they are paid. The Splits app registers them
  in the payer's approval.
- No owner: no admin, upgrade or rescue method. The token allow list is fixed at `new`.

## Build and test

```bash
cargo near build non-reproducible-wasm
cargo test --lib            # unit tests
cargo test --test '*'       # sandbox tests: real node, real NEP-141 token (../test-token)
```

`../test-token` is TEST DOLLAR, a plain NEP-141 token with no value, used by the sandbox tests.
