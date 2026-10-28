# Splits full audit, 2026-10-28

Scope: everything on `main` at `88d745b`. That covers the contracts (SplitsRouter, SplitsCrossPay), the
web backend (auth, money state machine, rules, deposits, cross-chain pay, visitor payments, Earn,
agent), the frontend, and ops (Dockerfile, compose, deploy script, CI).

Method: five read-only reviewers covered contracts, auth and API, money core, cross-chain and
deposits, and ops, frontend and dependencies. Every finding fixed below was then traced again in the
code before it was changed. Each fix has a test that fails without it, and the money-path ones are
also in the mutation checks.

Severity is about this product: real USDC, sign-in by email, payments approved with a PIN or passkey.

## Fixed in this change

| # | Severity | Finding | Fix | Proof |
|---|---|---|---|---|
| 1 | High | **OTP guesses could be raced.** `consumeLoginCode` read the attempt count, compared, then incremented in a separate query. Parallel `/api/auth/verify` calls all saw `attempts < 5`. That let an attacker take over accounts paid by email that never signed in. | Each guess reserves an attempt with one atomic `UPDATE ... WHERE attempts < 5 RETURNING` before comparing (the same pattern `verifyPin` uses). | `auth.test.ts` "parallel guesses..." passes on PGlite and Postgres; mutation `otp-guess-not-reserved` |
| 2 | High | **Code emails had no per-IP or global cap**, and the per-email cap was a racy count. That allowed email-bombing and burned Resend reputation. | `startSignIn` takes atomic `rate_hits` per email (5/h), per client IP (`SIGNIN_CODES_PER_IP_PER_HOUR`, 20) and in total (`SIGNIN_CODES_GLOBAL_PER_HOUR`, 600). | `auth.test.ts` "parallel code requests...", "limits code emails per client IP and in total" |
| 3 | High | **Any session could add a passkey without the PIN**, and a passkey approves payments. A stolen session could then pay without ever knowing the PIN. | Adding a passkey needs the PIN first (`startPasskeyRegistration` checks it under the normal lockout), so no registration challenge exists without it. Adding a passkey or changing the PIN signs out every other session. Setup and Settings pass the PIN. | `auth.test.ts` "adding a passkey" and "signing out other sessions"; mutation `passkey-without-pin` |
| 4 | High | **The cross-pay outcome could be forged.** SplitsCrossPay takes `payer` and `ref` from the hook, which the burner controls, and never checked `mintRecipient`. The server matched `CrossPaid`/`Refunded` on `(ref, payer)`. A stranger's burn with a copied hook could settle, fail or refund someone else's payment in the app, and the real burn was then never relayed. | The server now reads the outcome only for the CCTP nonce of this payment's own burn. It finds the transmitter's `MessageReceived(nonce)` and takes the first SplitsCrossPay event after it in that transaction (`outcomeAfterMint`). Iris messages are picked by this payment's hook hash. The event signature was checked against live Arc mainnet logs (51 mints in the last 5,000 blocks carry topic `0xff48c13e...`, nonce in `topics[2]`). | `outcome.test.ts` (forged, batched and look-alike events); `crossPay.test.ts` "...copies this payment's ref and payer"; mutations `cross-outcome-any-message`, `cross-outcome-first-mint`, `iris-first-burn` |
| 5 | High | **A savings rule could run twice on one payment.** The webhook keyed the automatic split on `inboundKey(txHash)` and the settled payment keyed it on `parent.id`, so the unique index never matched the two. | Both now use `inboundKey(arc tx hash)`. Opening an old receipt re-runs `triggerRules`, so the older `parent.id` key is looked for first and history never re-runs. | `flow.test.ts` "...webhook for the same money comes first", "...keyed by the payment's id"; mutations `rule-keyed-by-payment`, `rule-legacy-key-ignored` |
| 6 | High | **The October Node security bump never shipped.** CI used Node 22.23.4 while the Dockerfile still built `node:22.23.3`. | The Dockerfile defaults to 22.23.4, and CI passes `NODE_IMAGE=node:${NODE_VERSION}-bookworm-slim`, so the two can't drift again. | Docker build on the VPS (see Verification) |
| 7 | Medium | **Webhook rules ran on our own money.** A top-up from the treasury, an Earning withdrawal or a rule's own output could start a rule (even ping-pong) if the webhook beat the engine to recording the hash. | Arc inbound from the treasury, the Earning vault or any Splits wallet is ignored, since the payment that moved it runs any rule. A failure while starting a rule now forgets the delivery, so Circle's retry runs it. | `webhooks.test.ts` "starts no rule for money from the treasury..."; mutation `webhook-rule-on-own-money` |
| 8 | Medium | **Rules skipped the send limit.** The API accepted a rule paying any email or address, and rules run without a PIN and outside the limit. | A rule may only move money between the owner's own wallets, which is all the UI ever offered. | `flow.test.ts` "...only between the owner's own wallets"; mutation `rule-pays-anyone` |
| 9 | Medium | **A landed payment could be marked failed.** It read `refUsed` from a lagging node, after Circle called the send failed, and said "Nothing was sent". | A send with a hash decides by its own receipt. Not seen yet means wait (10 minutes from submit). The settle check reads `refUsed` at the receipt's block. | `flow.test.ts` "a send Circle reports as failed..."; mutations `failed-send-trusts-provider`, `ref-read-at-head` |
| 10 | Medium | **The simulated card defaulted to on.** In live mode it releases real treasury USDC to anyone who signs up. | Unset now means off on a live mainnet server. An explicit `FUNDING_ENABLED=true` is respected, because turning it on is your decision. `.env.example` now says so. | `config.test.ts` "keeps the simulated card off..." |
| 11 | Medium | **A missing `SPLITS_MODE` silently started preview** (simulated chain, codes on screen) on the real domain, and health couldn't tell. | The image defaults to `SPLITS_MODE=live`. `/api/health` reports `mode`, and the deploy job asserts `mode == "live"`. | `health.test.ts`; Docker smoke |
| 12 | Low | A PIN posted to the wrong confirm route used up the action. | `confirmAction` checks the action type before the PIN. | `flow.test.ts` "...wrong route..."; mutation `confirm-any-route` |
| 13 | Low | Raw RPC and provider errors (which can name a private node URL) were shown on payment and Earn pages. | Those pages show a fixed "trying again" line; the detail stays in the server log. | Covered by existing flow tests |
| 14 | Low | Recipient emails named a visitor by the email they typed, unverified. That made it possible to send "Coinbase sent you $0.01". | Visitors are named by their wallet address. | `visitorPayments.test.ts` "names a visitor..." |
| 15 | Low | The agent had an hourly cap only, so a full hour could repeat all day. | Added a global daily cap on model calls (`AGENT_DRAFTS_GLOBAL_PER_DAY`, 1,500). | `agentDrafts.test.ts` "stops at the global daily cap..." |
| 16 | Low | No security headers. | `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy: same-origin`, HSTS. A full CSP waits on an audit of the wallet SDKs. | Build |
| 17 | Low | The API container kept default capabilities. | `cap_drop: [ALL]`, `no-new-privileges`. | Needs the next deploy to confirm (see open items) |

### SplitsCrossPay source (needs a redeploy you run)

The deployed contract at `0xB018A94bbC5Ce6272FB16BC8Db3d802C8ebA0e79` has no admin and can't be
changed. Fix 4 already protects the app against it. The source now carries the contract-side fixes
for the next deployment:

- `relay` reverts unless the message's `mintRecipient` is this contract.
- The router ref and `CrossPaid`'s payer come from the burner CCTP attests. The hook's `refundTo` only
  says where refunds and change go, so a copied hook can neither spend nor speak for another payer's ref.
- A `refundTo` of this contract or the token falls back to the burner (the money was stranded before).
- A hook with more than `MAX_LEGS` (300) legs is refunded rather than being unrelayable forever.

Proof: 4 new unit tests, 4 new mutations (all killed), 7/7 fork tests on Arc mainnet state. The preview
chain mirrors the new source.

## Second round, the same day

Everything that was left open after the first round, fixed and verified the same way (commits
`d14e1f5` and the test fixes after it).

| # | Severity | Finding | Fix | Proof |
|---|---|---|---|---|
| 18 | Medium | A deposit move could burn again after one RPC wrongly said "no receipt", orphaning the first burn. | It burns again only on a reverted receipt, or with no receipt while the deposit wallet still holds the amount. Otherwise the move is flagged "burn unconfirmed" for a person. | `deposits.test.ts` "never burns again when one node..."; mutation `deposit-reburns-on-missing-receipt` |
| 19 | Medium | A move that hit 8 failures stopped but still held its address, so later deposits there never moved. | It ends as `stuck` and is logged for attention. If nothing was burned yet, its deposits wait and ride along with the next deposit's move, which burns the fresh balance. | `deposits.test.ts` "ends a move that keeps failing..."; mutation `deposit-move-never-ends` |
| 20 | Medium | Checking a list made a Circle wallet for every email before anything was paid (about 50,000 an hour were possible). | New wallets are capped per sender (`NEW_WALLETS_PER_SENDER_PER_HOUR`, 100) and in total (`NEW_WALLETS_GLOBAL_PER_HOUR`, 1,000), for lists and splits alike. People who already have a wallet don't count. | `payouts.test.ts` "caps the new wallets..."; mutation `new-wallets-uncapped` |
| 21 | Medium | The deploy user has full sudo, and `splits-deploy` checked files in a directory that user owns, then read them again. | The script copies the bundle into the root-owned release directory before checking it, refuses symlinks, and refuses a compose file asking for bind mounts, privileges, host namespaces or devices. `deploy/README.md` has the steps for a `splits-ci` user whose only right is the script. | Script review; the steps are yours to run on the host |
| 22 | Medium | SplitsCrossPay's out-of-gas check is a 1/16 ratio, so a relayer might pick a gas limit that refunds a payable split. | **Disproven on real Arc USDC.** A fork test relays a 20-recipient payment at every gas limit, coarse first and then 100 gas at a time below the lowest that pays, and none refunds. | `ArcFork.t.sol` `test_Fork_NoGasLimitTurnsAPaymentIntoARefund` (8/8 fork tests) |
| 23 | Low | The freshness guard trusted the highest height any RPC reported, and never checked chain ids. | With three or more RPCs the reference is the highest height two agree on. A height far above it isn't current. An RPC on another chain is dropped and logged once. | `freshness.test.ts` (3 new cases); mutations `wild-height-trusted`, `other-chain-rpc-used` |
| 24 | Low | A payment's lease was cleared unconditionally, so a slow worker could clear the next worker's lease. | Released only if it is still ours. Waits for chain evidence that pass 30 minutes are logged once as needing attention. The wallet slot is never released on a timer, since money could still land. | `flow.test.ts` "...leaves the next worker's lease alone"; mutation `lease-cleared-unfenced` |
| 25 | Low | Two Earn moves drafted side by side could both run, and earn-in could drain a wallet mid-payment. | A confirm is refused while another move on that pocket is active. Earn-in waits while a payment holds the main wallet. | `earn.test.ts` "runs only one of two moves..."; mutation `earn-confirms-side-by-side` |
| 26 | Low | Deploy secrets were reachable from any branch's workflow. | The deploy job runs in a `production` environment. Restricting it to `main` and moving the `VPS_*` secrets in is a repository setting you own. | `deploy.yml` |
| 27 | Info | `script/Deploy.s.sol` used plain `new`, while the record says CREATE2. | It deploys through the same factory with salt `keccak256("splits.router.v1")` (checked: `0x3d10f73c...`, as recorded). | `cast keccak` against `deployments/arc-mainnet.json` |

Also verified: production runs with `FUNDING_ENABLED=false`, so the simulated card was never
releasing treasury USDC there.

## Third round: found by the staging payment

The SplitsCrossPay v2 test payment from Base Sepolia (relay `0x03b9fd04...5a84` on Arc Testnet) paid
all 5 legs, named the attested burner as payer and used the burner-keyed router ref. The staging log
then showed this:

| # | Severity | Finding | Fix | Proof |
|---|---|---|---|---|
| 28 | Medium | The search for a payer's untracked burns (a tab closed before the hash was reported, or a second burn for one link) read source-chain logs 2,000 blocks a call. The default RPCs refuse that on Base (`mainnet.base.org` refuses getLogs entirely; `sepolia.base.org` serves 200), Avalanche (100), Monad (100) and Unichain Sepolia (1,000), so on those chains such a burn would never be relayed or refunded. Production uses those defaults (no `SOURCE_RPCS`). Staging logged the failure every 30 seconds. | Base and Avalanche read through publicnode, which serves 10,000 blocks (chain id and CCTP domain checked on both networks). Each chain records the range its RPC serves, a refused range is halved and remembered, and a rate limit or an outage still fails. Each search covers only the blocks since the last one plus a 64-block reorg tail, so a 100-block RPC isn't asked for 2 hours of blocks every 30 seconds. | `sources.test.ts` "searching a payer's burns" (5 cases); mutations `burns-no-narrowing`, `burns-skip-recent`, `burns-rescan-everything`, `burns-keeps-earlier`, `burns-narrows-on-outage`, `burns-rate-limit-narrows`; on staging, no errors after the restart and all 8 chains open |

## Still open

| Severity | Item | Why |
|---|---|---|
| Medium | SplitsCrossPay's contract-side fixes are on Arc Testnet (`0x2BC1a255672e7cf8Dd09e77Fe8dD0a0962aE2116`, Sourcify exact match, staging switched and paid from Base Sepolia), not yet on mainnet. | The mainnet redeploy (and `CROSS_PAY_ADDRESS` change) is yours to run. Until then the server-side fix (#4) protects the app. |
| Medium | The `splits-ci` user and the `production` environment's branch rule and secrets. | Host and repository settings you own (steps in `deploy/README.md`). |
| Low | Earn-in waiting for a payment has no test of its own. | It is a read-only check before the first Earn transfer. Earn is off on mainnet. |
| Info | `SplitsRouter.previewSend`'s comment says it reverts like `send`; it doesn't check `active` or the version. | Editing NatSpec changes the metadata hash, so Sourcify would stop matching the deployed router. Fix it with the next router version. |
| Info | `contracts/broadcast/` (untracked) holds only public transaction data. | Commit it as deployment evidence, or add it to `contracts/.gitignore`; your call. |

## Verification

All runs were on the test VPS, each in a throwaway workspace:

- Contracts: format clean, build, 112 unit, fuzz and invariant tests, 8/8 fork tests on Arc mainnet state, 18/18 mutations.
- Web: typecheck, 417/417 tests on PGlite and on Postgres 17, 79/79 mutations, production build,
  HTTP API smoke test (after the third round).
- Image: the Docker image builds on `node:22.23.4-bookworm-slim`, then starts healthy as user `node`
  with `mode` in `/api/health`.

## Checked and sound

Money is integer-only throughout. Fees are fixed at quote time and can't be changed between quote and
PIN. The send limit is taken under an advisory lock. Provider writes use deterministic idempotency
keys backed by unique indexes. Settling is decided by chain receipts, never by provider
acknowledgements. Deposits are verified on chain before they count, and are never minted twice.
Webhook signatures are verified over the raw body. CSRF is checked by origin. Session, PIN and OTP
storage is hashed. The agent can only draft; every payment still needs the PIN. Every dependency is
pinned exactly with integrity hashes, and every CI action is pinned by SHA. No secrets are in the tree
or its history.
