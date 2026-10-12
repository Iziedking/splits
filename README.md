# Splits

Split any payment, to anyone, in one transaction on Arc.

**Live on Arc mainnet at [mysplits.xyz](https://mysplits.xyz).** The router contract is
[verified on Sourcify and the Arc explorer](https://explorer.arc.io/address/0x8eDb15a372D3b691E2264fFc897EC53dFF4A64F2?tab=contract).

Splits started with one problem, and it is still the lead example. Someone in London supporting family in Lagos rarely sends money for one thing. Part of it is rent, part is a sibling's school fees, the rest is upkeep. Today they either send one lump sum and hope it gets divided the way they meant, or they make several transfers and pay fees on each.

With Splits, the sender says who gets paid, how much, and what for. The payment lands already divided, in one USDC transaction on [Arc](https://arc.io), with an onchain receipt that records what each part was for.

Recipients don't need to install anything. Their email address is their wallet.

The same engine pays anyone who needs a payment divided: twenty giveaway winners from one pot, a team's revenue share, or one person paid by email or Arc address. Paste the list (or describe it, or drop in a screenshot), check it, approve once, and everyone is paid in a single transaction, or nobody is.

## What you can do today

| | |
| --- | --- |
| **Pay one person or many** | By email or Arc address. Split a pot equally (to the cent) or set each amount. Up to 50 people in one transaction. |
| **Saved splits** | "40% rent, 35% school fees, 25% upkeep", registered onchain once and reused every month. |
| **Pay without an account** | Open [mysplits.xyz/send](https://mysplits.xyz/send) and pay straight from your own wallet: browser wallets or any WalletConnect wallet. You keep a private status link for the payment. |
| **Describe it, I split it** | Agentic mode: paste rough text ("300 between ada@x.com, 0x12… and Tunde, Tunde gets double") or up to 3 screenshots of a chat or spreadsheet. Claude Haiku 5.5 on Amazon Bedrock fills in the list; you check it and pay as usual. |
| **Receipts per person** | Every recipient gets a private receipt showing only their part and what it was for. The sender chooses whose receipt to share. |
| **Automatic splits** | A recipient can divide what they receive, such as "30% of everything into savings". It runs by itself when money arrives. |
| **Activity** | Money in and out, each with its receipt, paged. |

## How a payment moves

```mermaid
flowchart LR
  A["Sender<br/>email wallet or own wallet"] --> C["SplitsRouter on Arc<br/>one transaction"]
  C --> D["Landlord<br/>5.08 USDC, rent"]
  C --> E["School<br/>4.44 USDC, school fees"]
  C --> F["Sister<br/>3.18 USDC, upkeep"]
  C --> X["Splits fee<br/>0.19 USDC"]
  F -. "her own automatic split" .-> G["Savings pocket<br/>0.95 USDC"]
```

1. **Check.** The list is read before anything moves: duplicates, your own wallet, malformed lines and addresses that can't receive USDC right now (a free simulated 1-cent transfer) are marked, and the list can't be approved until they're fixed. The screen shows exactly what each person gets, the Splits fee and the total.
2. **Approve.** Signed-in senders approve with a 6-digit PIN or a passkey (Face ID, fingerprint). Senders without an account approve in their own wallet: the exact total, then the payment.
3. **Pay.** The router pays every recipient in one transaction, or nobody if any leg fails. Each person's part is a `LegPaid` event with its purpose.
4. **Verify.** The app reads the receipt back from Arc and checks every payout against what was approved before it says "Landed".
5. **Tell.** People paid by email get a "you received money" email and find it in their balance when they sign in.

An equal pot is split to the cent: $100 across 7 winners pays four of them $14.29 and three $14.28.

## Why Arc

- **USDC is the gas token.** Fees are small and in dollars, which matters for a product whose point is avoiding unpredictable transfer costs. Paying 10 people costs about a cent of gas.
- **Transactions are final when they are included.** "Your family has it" appears seconds after the sender approves.
- **The split is a contract, not a promise.** Dividing one payment between several people with a purpose attached to each part is a smart contract job. A normal wallet or remittance app doesn't do it.
- **It connects to Circle's stack.** Circle wallets on Arc give email-based accounts whose gas the app pays through Gas Station. Circle's App Kit gives the routes in and out of local money (see the roadmap).

## The contract

[`SplitsRouter.sol`](contracts/src/SplitsRouter.sol) is small on purpose:

- **It never holds money.** USDC goes straight from the payer to each recipient with `transferFrom`. There is no owner, no admin and no rescue function, so there is nothing to drain and no key that can redirect a payment.
- **All or nothing.** If any recipient can't be paid, for example an address on Arc's blocklist, the whole payment reverts.
- **No double payments.** Each payment carries a reference, and the router refuses the same reference twice from the same payer, so a retried request can never pay twice.
- **No fee logic.** The Splits fee is set by the app and travels as one more leg in the same transaction, visible to the payer before they approve. The contract treats it like any other recipient.
- **One-off and saved splits.** `pay(legs, amount, ref)` pays a list once without storing it. Saved splits are versioned: a payment names the version the sender saw, and reverts if the split changed in between.
- **Whole cents only.** Nobody is ever paid a fraction of a cent.
- **No recipient limit in the contract.** One transaction's gas is the real limit: measured on a mainnet fork at 49,160 gas per recipient, so the app allows at most 300 and defaults to 50.

It is deployed through the standard CREATE2 factory, so testnet and mainnet share one address.

## The app

- **Accounts:** email sign-in with one-time codes. No passwords or seed phrases.
- **Wallets:** [Circle developer-controlled wallets](https://developers.circle.com/wallets/dev-controlled) on Arc, as smart contract accounts, with gas sponsored by Circle Gas Station.
- **Paying from your own wallet:** [Reown AppKit](https://reown.com/appkit) with browser wallets and WalletConnect, loaded only on the pages that need it. The payment is reserved for 30 minutes and verified onchain by its reference, so a closed tab or a slow wallet never loses or doubles a payment.
- **Splits fee:** 1.5% (2% from 10 recipients), paid by the sender on top and shown before approval. Set by the server's settings, fixed per payment when it is quoted, and never in the contract.
- **Send limit:** until identity verification is added, nobody sends more than 500 USDC per payment or per rolling 24 hours, fee included. Visitors without an account have the same limit, tracked by wallet and email.
- **Agentic mode:** signed-in only, 20 drafts a day per account and a global hourly cap. The model can only fill the list form: it never sees balances and never pays. Pasted text and screenshots are never stored or logged. Claude Haiku 5.5 was chosen over Nova 2 Lite after scoring 10 of 10 on a fixed test set that includes screenshots and an injection attempt.
- **Payment engine:** each payment is a resumable state machine. Every Circle request carries a key derived from the payment, so a retry returns the original transaction instead of sending a second one. A background sweeper finishes payments nobody is watching.
- **Preview mode:** with no keys at all, the app runs against an in-memory copy of Arc and the router that applies the same rules, so anyone can try the full flow.

## Repo

| Path | What it is |
| --- | --- |
| [`contracts/`](contracts) | `SplitsRouter` with Foundry tests, a mutation check and fork tests against Arc mainnet state |
| [`web/`](web) | The Next.js 16 app. UI in `src/app`; backend (Circle wallets, chain reads, payment engine, agentic mode) in `src/server` |
| [`deploy/`](deploy) | Production: Docker Compose (app and Postgres), the deploy script with automatic rollback |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | One push to `main` tests, builds and deploys |
| [`deployments/`](deployments) | The exact contract build used for deployment, and deployment records |

## Run it

Preview mode needs only Node 22. It uses no keys, no money and no network:

```bash
cd web
npm ci
npm run dev
```

Open http://localhost:3000. Preview mode shows the sign-in code on screen, and agentic mode uses a built-in stand-in instead of Bedrock.

Tests:

```bash
cd web && npm test
cd contracts && forge soldeer install && forge test
```

Fork tests need [Arc Foundry](https://github.com/circlefin/arc-foundry), because USDC on Arc checks a blocklist precompile that stock Foundry doesn't know about:

```bash
ARC_FORK_RPC=https://rpc.mainnet.arc.io arc-forge test --network arc --match-contract ArcForkTest
```

### Production

Every push to `main` runs the [deploy workflow](.github/workflows/deploy.yml): typecheck, the full test suite and a build (the contract compiled with the checksum-pinned Arc Foundry), then a Docker image. The image is copied to the server, started next to its own Postgres, and kept only if it reports healthy within two minutes; otherwise the previous release is restored. A database dump is taken before every release. Details are in [`deploy/README.md`](deploy/README.md).

To run your own: copy [`web/.env.example`](web/.env.example), add a Circle API key, run `node scripts/circle-setup.mjs <env file>` (it creates the wallet set and treasury wallet and never prints a secret), activate a Gas Station policy for Arc, and deploy the router with `node scripts/deploy-router.mjs <env file> ../deployments/artifacts/SplitsRouter.json ../deployments`, which checks the deployed code onchain before writing the record. Live mode won't start with a missing key, a mismatched chain id, or testnet-only shortcuts on mainnet.

## Status

| Part | State |
| --- | --- |
| Contract | 46 unit and fuzz tests; 14 of 14 deliberate bugs caught by the mutation check; 5 fork tests on Arc mainnet state, including the gas measurement and a plain wallet paying through the router. Verified (exact match) on Sourcify and the Arc explorer. |
| App | 224 tests; 28 of 28 deliberate bugs caught by the mutation check; an end-to-end API check over real HTTP; both build modes; the production image started and checked healthy before release. |
| Arc mainnet | Live at [mysplits.xyz](https://mysplits.xyz), deployed by the workflow above. |
| Arc Testnet | Live staging, used for every change before mainnet. |
| Card checkout (onramp) | Simulated on testnet; switched off on mainnet. See the roadmap. |
| Cash-out to bank or mobile money (offramp) | Not built. Shown in the app as "Coming soon"; recipients hold USDC. |

## Deployments

| Network | SplitsRouter | Record |
| --- | --- | --- |
| Arc mainnet (5042) | [`0x8eDb15a372D3b691E2264fFc897EC53dFF4A64F2`](https://explorer.arc.io/address/0x8eDb15a372D3b691E2264fFc897EC53dFF4A64F2) | [`arc-mainnet.json`](deployments/arc-mainnet.json) |
| Arc Testnet (5042002) | [`0x8eDb15a372D3b691E2264fFc897EC53dFF4A64F2`](https://explorer.testnet.arc.io/address/0x8eDb15a372D3b691E2264fFc897EC53dFF4A64F2) | [`arc-testnet.json`](deployments/arc-testnet.json) |

The mainnet router was deployed in [`0x4e6e…750f`](https://explorer.arc.io/tx/0x4e6ec03354f5e5c6cb0ffe5d2010af145a3443e02bffe230be5a0ef282bc750f) from the app's Circle treasury wallet, with gas paid by Gas Station.

The first payment on mainnet split $0.03 between three addresses from an email account's wallet, approved with a PIN, in [one transaction](https://explorer.arc.io/tx/0x3bdef0852fbf7493e030b1affec7f9b34e42f8937dc179e05d112a83828a28c2): one `SplitSent` and three `LegPaid` receipts, with about $0.007 of gas paid by Gas Station.

The first live giveaway on testnet paid 20 people, 15 Arc addresses and 5 email recipients, 0.10 USDC each from a 2.00 pot, in [one transaction](https://explorer.testnet.arc.io/tx/0x70ffeac219fdcaf6b29a56eb1dc56687b9149cee46714626d8330606adf4ccc2): one `SplitSent` with split id 0 and 20 `LegPaid` receipts, each marked "giveaway prize".

## Roadmap

Each item is designed and built the same way as everything above: a written design, a plan, tests first, a fresh review, then staging before mainnet.

### 1. Onramp: pay by card, Apple Pay, Google Pay or bank transfer

Today a sender needs USDC, in their Splits balance or in their own wallet. With [Circle's App Kit Onramp](https://developers.circle.com/) (`@circle-fin/onramp-kit`), a sender in London pays by card, Apple Pay, Google Pay or bank transfer, and the USDC lands directly in their Splits wallet on Arc, ready to be split. It stays behind a switch until Circle's business verification (KYB) for Splits clears, and the simulated card on testnet is replaced by it.

### 2. Offramp: cash out to a bank or mobile money

Recipients hold USDC today. The next step is letting the sister in Lagos turn her part into naira in her bank account or mobile money wallet, through a licensed payout partner, from the same balance screen where "Bank or mobile money" now says "Coming soon". A split can then end in local money, not only in a wallet.

### 3. Earning pocket with Arc Earn Kit

Money that sits in a Splits balance between payments could earn. An opt-in **Earning pocket** uses [Arc Earn Kit](https://community.arc.io/home/blogs/earn-kit-on-arc-embedded-usdc-and-eurc-lending-opportunities-2026-09-28) (`@circle-fin/earn-kit`, lending through Morpho vaults on Arc):

- Off by default. Turning it on shows the vault, the current rate, that it is variable and not guaranteed, and how to withdraw.
- Works with automatic splits: "30% of everything I receive goes to my Earning pocket".
- Move money in and out with the same PIN or passkey approval as a payment; withdrawals go back to the spendable balance.
- The first step is a check that the vaults are live on Arc mainnet with enough liquidity, before any build.

### Also planned

- **Usernames:** pay `@tunde` instead of an email or address. Already recognised in lists, where they show "coming soon".
- **Identity verification in the profile,** with names moving from sign-up to the profile, to raise the 500 USDC limit.
- **Google sign-in,** landing on the same email account.
- **Brand and desktop design:** logo, branded emails and favicon, and a desktop layout from the design team.

## Things to know

- **The app holds the keys for email wallets.** Circle developer-controlled wallets are custodial: the app's Circle account controls them, and the PIN or passkey is the gate before it acts. People who want to keep their own keys can pay from their own wallet at [/send](https://mysplits.xyz/send).
- **The app pays the gas for email wallets** through Circle Gas Station, within daily limits set in the Circle console.
- **Built for the [Arc Microgrants](https://dorahacks.io/hackathon/arc-microgrants/detail) program.** It is a working product on mainnet with a 500 USDC send limit, not yet a licensed money transmitter; the limit stays until identity verification is in place.
