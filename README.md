# Splits

Split any payment, to anyone, in one transaction on Arc.

Splits started with one problem, and it is still the lead example. Someone in London supporting family in Lagos rarely sends money for one thing. Part of it is rent, part is a sibling's school fees, the rest is upkeep. Today they either send one lump sum and hope it gets divided the way they meant, or they make several transfers and pay fees on each.

With Splits, the sender sets up a split once: who gets paid, how much, and what for. Every payment through it lands already divided, in one USDC transaction on [Arc](https://arc.io), with an onchain receipt that records what each part was for.

Recipients don't need to install anything. Their email address is their wallet.

The same engine pays anyone who needs a payment divided: twenty giveaway winners from one pot, a
team's revenue share, or one person paid by email or Arc address. Paste the list, check it, approve
once, and everyone is paid in a single transaction, or nobody is.

## How a payment moves

```mermaid
flowchart LR
  A["Sender pays £10<br/>by card (simulated)"] --> B["12.70 USDC<br/>in the sender's wallet"]
  B --> C["SplitsRouter on Arc<br/>one transaction"]
  C --> D["Landlord<br/>5.08 USDC, rent"]
  C --> E["School<br/>4.44 USDC, school fees"]
  C --> F["Sister<br/>3.18 USDC, upkeep"]
  F -. "her own automatic split" .-> G["Savings pocket<br/>0.95 USDC"]
```

1. The sender signs in with an email code. A Circle wallet is created for them, and for every recipient named by email.
2. They create a split, for example 40% rent, 35% school fees and 25% upkeep. They approve it with their PIN or Face ID / fingerprint, and it is registered onchain.
3. They send £10. The app shows exactly what each person gets before anything moves.
4. After approval, the app tops up the sender's wallet, approves the exact amount, and calls the router. The router pays every recipient in a single transaction, or pays nobody if any leg fails.
5. The app reads the receipt back from Arc and checks every payout against what the sender approved, before it shows "Delivered".
6. A recipient can set their own automatic split, such as "put 30% of everything I receive into savings". It runs by itself when money arrives.

### Paying many people at once

1. On **Pay**, paste one person per line: an email or an Arc address, and optionally an amount and a label. Choose "Split a pot equally" or "Set each amount".
2. **Check** reads every line before anything moves. Duplicates, your own wallet, malformed lines and addresses that can't receive USDC right now (a free simulated 1-cent transfer) are marked, and the list can't be approved until they're fixed. Email recipients get a wallet here.
3. The checked list is saved as a draft. Approving with your PIN or passkey pays exactly that list, once; a second click or a changed list is refused.
4. The router's `pay` function pays everyone in one transaction with a `LegPaid` receipt per person. People paid by email get a "you received money" email and find it in their balance when they sign in.

An equal pot is split to the cent: $100 across 7 winners pays four of them $14.29 and three $14.28. No two winners differ by more than a cent.

## Why Arc

- **USDC is the gas token.** Fees are small and in dollars, which matters for a product whose point is avoiding unpredictable transfer costs.
- **Transactions are final when they are included.** "Your family has it" can appear seconds after the sender approves.
- **The split is a contract, not a promise.** Dividing one payment between several people with a purpose attached to each part is a smart contract job. A normal wallet or remittance app doesn't do it.
- **It connects to Circle's stack.** Circle wallets on Arc give email-based accounts with gas paid by the app (Gas Station). CCTP and Circle's onramp give a route from local money in and out of Arc.

## What's in the repo

| Path | What it is |
| --- | --- |
| [`contracts/`](contracts) | `SplitsRouter`, the Solidity contract, with Foundry tests, a mutation check and a fork test against Arc mainnet state |
| [`web/`](web) | The Next.js 16 app. The UI is in `src/app`; the backend (Circle wallets, chain reads, payment state machine) is in `src/server` |
| [`deployments/`](deployments) | The exact contract build used for deployment, and deployment records |

### The contract

[`SplitsRouter.sol`](contracts/src/SplitsRouter.sol) is small on purpose:

- **It never holds money.** USDC goes straight from the payer to each recipient with `transferFrom`. There is no owner, no admin, no fee and no rescue function, so there is nothing to drain and no key that can redirect a payment.
- **All or nothing.** If any recipient can't be paid, for example an address on Arc's blocklist, the whole payment reverts.
- **No double payments.** Each payment carries a reference, and the router refuses to use the same reference twice for the same payer, so a retried request can never pay twice.
- **No recipient limit.** Neither `send` nor `pay` caps the number of recipients; a long list only costs its caller gas. The app's limit is a setting, `MAX_PAYOUT_RECIPIENTS` (default 50), bounded by what one Arc transaction can carry: measured on a mainnet fork at 49,160 gas per recipient against a 30,000,000 block gas limit, so the app allows at most 300.
- **One-off payments.** `pay(legs, amount, ref)` pays a list once without storing it, under the same rules, and emits split id 0.
- **No surprise edits.** A payment names the split version the sender saw. If the split changed in between, the payment reverts instead of paying the new recipients.
- **Whole cents only.** Each share is rounded down to a cent, and the leftover cent goes to the last share. Nobody is ever paid a fraction of a cent.
- **Purpose receipts.** Every payout emits `LegPaid` with the recipient, the amount and the purpose label.

It is deployed through the standard CREATE2 factory, so testnet and mainnet share one address.

### The app

- **Accounts:** email sign-in with one-time codes. No passwords or seed phrases.
- **Wallets:** [Circle developer-controlled wallets](https://developers.circle.com/wallets/dev-controlled) on Arc, as smart contract accounts, so Circle Gas Station pays the gas.
- **Approvals:** every new split and every payment must be approved with a 6-digit PIN or a passkey (Face ID, fingerprint). Five wrong PINs lock approvals for 15 minutes.
- **Payment engine:** each payment is a resumable state machine: funding, then approval, then sending, then verifying. Every Circle request carries a key derived from the payment, so a retry returns the original transaction instead of sending a second one. A background sweeper finishes payments nobody is watching.
- **Preview mode:** with no keys at all, the app runs against an in-memory copy of Arc and the router that applies the same rules, so anyone can try the full flow.

## Run it

Preview mode needs only Node 22. It uses no keys, no money and no network:

```bash
cd web
npm ci
npm run dev
```

Open http://localhost:3000. Preview mode shows the sign-in code on screen.

Tests:

```bash
cd web && npm test
cd contracts && forge soldeer install && forge test
```

Contract tests that fork Arc need [Arc Foundry](https://github.com/circlefin/arc-foundry) and `--network arc`, because USDC on Arc checks a blocklist precompile that stock Foundry doesn't know about:

```bash
ARC_FORK_RPC=https://rpc.mainnet.arc.io arc-forge test --network arc --match-contract ArcForkTest
```

### Live setup (testnet or mainnet)

1. Copy [`web/.env.example`](web/.env.example) and set `SPLITS_MODE=live` and the network values.
2. Add your Circle API key, then run `node scripts/circle-setup.mjs <env file>`. It registers an entity secret if you don't have one, then creates a wallet set and a treasury wallet. It never prints a secret.
3. Fund the treasury wallet with USDC.
4. Deploy the router with `node scripts/deploy-router.mjs <env file> ../deployments/artifacts/SplitsRouter.json ../deployments`. It checks the deployed code onchain before writing the record.
5. Set `SPLITS_ROUTER_ADDRESS` and start the app.

Live mode won't start with a missing key, a mismatched chain id, or (on mainnet) the testnet-only shortcuts.

## Status

| Part | State |
| --- | --- |
| Contract | Tested: 46 unit and fuzz tests, 14 of 14 deliberate bugs caught by the mutation check, 4 fork tests on Arc mainnet state (including the gas measurement) |
| App, preview mode | Tested: 89 tests, 12 of 12 deliberate bugs caught, an end-to-end API check that pays a 20-person giveaway, and a browser walkthrough at desktop and phone width |
| Arc Testnet deployment | Live. Payments run end to end with Circle wallets and Gas Station, and are checked onchain |
| Arc mainnet deployment | Not yet |
| Card payments and currency exchange | Simulated. The card isn't charged and the rate is fixed. The USDC leg is real in live mode. |
| Payout to bank or mobile money | Not built. Shown in the app as "Coming soon". Recipients hold USDC. |

## Deployments

| Network | SplitsRouter | Record |
| --- | --- | --- |
| Arc Testnet (5042002) | [`0x8eDb15a372D3b691E2264fFc897EC53dFF4A64F2`](https://explorer.testnet.arc.io/address/0x8eDb15a372D3b691E2264fFc897EC53dFF4A64F2) | [`arc-testnet.json`](deployments/arc-testnet.json) |
| Arc mainnet (5042) | not deployed yet (same address once deployed) | |

The first live giveaway on testnet paid 20 people, 15 Arc addresses and 5 email recipients, 0.10 USDC each from a 2.00 pot, in [one transaction](https://explorer.testnet.arc.io/tx/0x70ffeac219fdcaf6b29a56eb1dc56687b9149cee46714626d8330606adf4ccc2): one `SplitSent` with split id 0 and 20 `LegPaid` receipts, each marked "giveaway prize".

The first live payment, on the earlier router without `pay` ([`0xEAE0…f41F`](https://explorer.testnet.arc.io/address/0xEAE06dFe0B89816BB8a04CA33474388D9B59f41F)): £1 became 1.27 USDC, paid as 0.50 for rent, 0.44 for school fees and 0.33 for upkeep in [one transaction](https://explorer.testnet.arc.io/tx/0x826b56a479d420f1b46294ba78e4e4e1fd1f70ce314104ae231006137f8d0f0f), with each part's purpose in its `LegPaid` event.

## Things to know

- **The app holds the keys.** Circle developer-controlled wallets are custodial: the app's Circle account controls the wallets, and the PIN or passkey is the gate before it acts. This is not a non-custodial wallet.
- **Card funding is simulated.** In live mode, a simulated card payment releases real USDC from the app's treasury. Per-payment, per-user and global daily limits cap that spend, and `FUNDING_ENABLED=false` switches it off.
- **Built for the [Arc Microgrants](https://dorahacks.io/hackathon/arc-microgrants/detail) program.** Its scope is one corridor (UK or US to Nigeria) and a working proof, not a licensed money transmitter.
