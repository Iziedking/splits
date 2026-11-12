# Proving Splits on NEAR from a terminal

Two commands, no wallet, no keys and no browser. Run them from the repository root.

## 1. Contract tests

```bash
bash near/proof/contract-tests.sh
```

Runs the router's 14 unit tests, then a sandbox test: a local NEAR node with a real NEP-141 token, paying splits through `ft_transfer_call`. Uses your Rust if it has rustup and glibc 2.38 or newer, otherwise Docker (`--docker` forces it). The first Docker run downloads the image, Rust 1.95 and cargo-near 0.23.0, so allow about ten minutes; later runs take about three.

You should see `== All contract tests passed`.

## 2. A real payment run on NEAR testnet

```bash
cd near/proof && npm ci && node testnet-proof.mjs
```

Needs Node 20 or newer. Takes about three minutes and prints `PASS` or `FAIL` for each check, with a testnet explorer link for every transaction:

1. Downloads the code of the live router, `splits.kingizie.testnet`, and checks it against the hash NEAR stores for it.
2. Creates a fresh account from the public testnet faucet, deploys that exact router code to `router.<account>`, and deploys TEST DOLLAR (a test token with no value) from `splits-test-dollar.testnet` so it can mint its own money. The live router accepts only Circle's testnet USDC, which a script cannot mint.
3. Proves:
   - **a.** a split payment: 3.00 to three people in one approval, each part landing with its purpose, the router left holding nothing;
   - **b.** the same payment again with the same reference: refused (`ref_already_used`), nothing moves;
   - **c.** a part to an account that cannot hold the token comes back to the payer, and the other parts still land;
   - **d.** "auto-split my income into tax, savings and spending": an account saves 30/20/50 once, then a 10.00 payment naming only her divides itself on arrival into 3.00, 2.00 and 5.00;
   - **e.** a payer who saw an older version of her split is refused (`stale_split_version`) and keeps the money;
   - **f.** a group fund: a second faucet account founds a Sputnik DAO (`sputnikv2.testnet` factory) with two council members. One proposes a `set_split` call to the router; after one yes vote the group still has no split, after the second the proposal passes and the DAO's split is saved; a 10.00 payment to the group then divides 4.00 rent, 3.00 bills, 3.00 trip fund, and neither the router nor the DAO keeps any of it.

It ends with `All checks passed.` and exits non-zero if any check fails. Set `NEAR_RPC` to use another testnet RPC.

`splits-test-dollar.testnet` was published once with `publish-token-code.mjs` and its only key was deleted, so its code cannot change. Its code hash is `3Hh8nnvjM7dSokaAqCWj9dYtkkq6swWkR277HxXMJbJq`, from `near/test-token` built by command 1 (`near/target/near/test_token.wasm`).
