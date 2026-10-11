# Splits UI brief

## v4 visual direction (2026-10-11): "Glass and teal", from the design team

Source: the team's Figma file "Splits — UI Draft" (mobile frames S1 Welcome to S8 Confirmation,
plus Welcome Page, Email/Sign up, Connect Bank and two Dashboards). It replaces the v2 adire
direction below for colour, type and surfaces. A PC layout is still to come from the designer, so
until then wide screens show the same mobile composition, centred, rather than an invented desktop
layout. The Figma file is read only; nothing in it was changed.

| Token | Value | Use |
| --- | --- | --- |
| Teal | `#0FA39A` | primary pills, links, "They receive" figures, progress dots |
| Teal deep | `#0B8780` | hover and pressed teal |
| Ink | `#0E1C2B` | headings, figures, body |
| Slate | `#5B6B78` | secondary text |
| Mist | `#F3F7F8` | page base under the gradient |
| Purpose fills | teal `#2BC4BA`, lilac `#9B8CF2`, coral `#F2896D`, then amber `#F5B83D`, sky `#5AA9F5`, lime `#8FCB5A` | split parts, in order |
| Night | `#0A1A22` to `#0F2A2E` | the live "Sending…" screen |

- **Type:** Manrope only. Bold headings (32px on phones), big bold figures, regular slate body.
- **Backdrop:** soft blurred blobs, teal at the top right, lilac mid-right, peach bottom-left, over
  mist. The live settlement screen uses the dark night variant with a teal glow and a warm glow.
- **Cards:** frosted glass: white at about 65% opacity, backdrop blur, a 1px white edge and a soft
  ink shadow, 18px radius. Without backdrop-filter support they fall back to solid white.
- **Actions:** one full-width teal pill per screen for the primary action, a teal-outline pill for
  the secondary one, both 52px tall.
- **Split parts:** separated rounded bars and a coloured dot per recipient; a coloured underline on
  each confirmation card.

**Mapping the frames onto the product without changing its truths:**
- Welcome and sign-up become the email-code sign-in. The design's username and password fields are
  not used: an email is the account and the wallet, and the code proves it.
- "They receive" stays in USD (USDC). The frames show naira, but recipients hold USDC and there is
  no naira payout yet, so a naira figure would promise something the app doesn't do.
- "How do you want to pay?" maps to the existing sources: the balance and the simulated demo card.
  Bank account appears as "Coming soon".
- "Sending…" maps the live states onto the step list: Funded, Approved, Settled on Arc, Receipt
  checked. Each step lights only when the server says it happened.
- The split stream from v2 is retired: the design's bars, dots and step list carry the same meaning.

Motion: unchanged rules (one entry settle, a dialog that rises, reduced motion turns it all off). The
blobs do not move.

## Pay from your own wallet, fees and the send limit (2026-10-11)

**Intent.** Anyone can pay a list straight from a wallet they already have, without an account or a
deposit. Every payment carries a small Splits fee on top, and nobody sends more than 500 USDC until
identity checks exist.

- **Entry.** `/send`, linked from the welcome screen as "Pay without an account". Signed-in people
  are sent to `/pay`. Same composer and line-by-line check as accounts (one person, or many).
- **Fee lines.** Wherever a total is approved (review, PIN sheet, saved-split preview, the visitor's
  wallet step): "Splits fee (1.5%) $0.03" and "You pay $2.03". Recipients get exactly what was typed.
  The landed screen adds "Plus a $0.03 Splits fee (1.5%)." Receipts and notice emails never show it.
- **Wallet steps.** "Pay $X from your wallet" opens the Reown sheet (browser wallets, WalletConnect
  QR, phone deep links; teal accent, Manrope). Then two labelled steps: "1 of 2: Allow Splits to send
  exactly $X" and "2 of 2: Send". Step 1 is skipped when an earlier approval covers it. Never an
  unlimited approval.
- **Status link.** After "Send", the page moves to `/p/<token>`: "Waiting for your wallet", then the
  night "Sending…" steps (Sent from your wallet, Settled on Arc, Receipt checked), then the shared
  "Landed" view with receipts and "Email me my receipt". The link keeps working on another device.
- **Limit copy.** Over the per-payment limit: "Payments over 500.00 USDC need identity verification,
  which is coming soon. Lower the total to continue." Over the day: "You can send $N more today.
  Your limit resets at HH:MM UTC." Visitors also see "Create an account to raise your limit" with
  the honest note that verified accounts will send more once identity checks arrive.
- **Failures.** No wallet: QR or "Open in your wallet app". Wrong network: switch to Arc, or how to
  add it. Not enough USDC: how much more, plus the faucet on testnet. Declined: "Nothing moved." Expired
  reservation: "This took longer than 30 minutes. Check the list again." A payment that fails the
  onchain check: "Not sent" with the reason.
- **Weight.** AppKit and wagmi load only on `/send` and `/p/<token>`, after the button is tapped.
  Coinbase's optional x402 packages are aliased to a stub (`lib/wallet/x402-absent.ts`): Splits never
  makes x402 payments.
- **Rejected:** a single signature via a permit function (needs a contract change days before mainnet);
  auto-detecting wallets without WalletConnect (phones in normal browsers couldn't pay).

## Receipts (2026-10-11): one receipt per recipient

**Intent.** After a payment lands, the sender can share each person's receipt with that person.
A receipt shows that recipient's part only: their amount, what it was for, their address, the
sender's first name and wallet, when it was paid, the network and the Arc transaction. It never
shows the total or anyone else in the payment. The reference was a pasted 21st.dev
"OrderConfirmationCard"; its structure (success mark, title, label and value rows, one action) is
kept, its look is replaced by v4 glass and teal, and framer-motion is not added.

- **Link, not login.** `/r/<token>` opens for anyone holding the link (24 random base64url
  characters, one per recipient, stored in `receipt_links`, made the first time the sender opens a
  settled payment). Unknown or malformed links get a 404 with a plain recovery line. Pages carry
  `noindex` and `no-referrer`.
- **Focal object.** The receipt card's top stripe is the colour that part had on the sender's
  screen, so a receipt reads as one slice of a payment.
- **Sender side (S8).** Every card on "Landed, divided." has "View receipt". "Share receipt"
  shares straight away for one recipient; for more it opens "Share a receipt", a sheet with one
  row per person (View and Share), and a search box once there are more than 8.
- **Share fallback.** Phone share sheet first, clipboard second. Where both are blocked the link is
  shown selected, so it can still be copied by hand.
- **Trust.** "Settled and checked" only for live payments, which settle after the Arc receipt is
  matched against what was approved. Preview receipts say "Simulated in preview" and show no
  explorer link.
- **Motion.** One CSS reveal (check pop, then lines settle in reading order). It runs on first
  paint and is turned off for print and reduced motion, so the receipt is readable without script.
- **Print.** "Print or save as PDF" prints the card only.
- **Rejected:** a single shared receipt for the whole payment (shows every recipient's amount to
  each of them); signed stateless tokens (needs a new production secret days before mainnet).

## v3: pay anyone, giveaways, add money (2026-10-11)

The user asked for Splits to work for anyone who needs to split money, with diaspora family support
staying the foundation: pay people who have no account (by email or Arc address), pay many people
in one go (a giveaway with 20 winners), put money into the balance, find and copy their own address,
and stop wasting half the screen. Design spec: `docs/superpowers/specs/2026-10-11-pay-anyone-giveaways-design.md`.

**Meaning:** one payment can reach everyone it's meant for, exactly, with a receipt that says what
each part was for. **Emotional contract:** after the first giveaway the sender feels certain that
every winner got the right amount, and that nothing would have moved if anything was wrong. It
would feel false if a bad line were only discovered after paying.

**Flows and the one primary action on each surface**

| Surface | Primary action | Supporting | Secondary until asked |
| --- | --- | --- | --- |
| Home | Pay | Add money, copy address, open a split | Start something, automatic split |
| Pay: one person | Check, then Pay $x | Pay from balance or demo card | Save as a split |
| Pay: many people | Check list, then Pay N people $total | Split a pot equally / set each amount | Save as a split |
| Add money | Copy address | QR code, demo card | Testnet faucet link (testnet only) |
| Profile | Copy address | Change PIN, add Face ID or fingerprint | Sign out |

**Discovery vs commitment.** Typing a list is free. Checking it creates wallets for emails and
probes each address but moves no money. Paying asks for the PIN or passkey, as every money
movement does. The checked list is the thing approved: editing it after a check clears the check.

**Focal object.** The SplitStream stays the product's gesture. A giveaway receipt reuses the
Ribbon, one block per winner, coloured in list order; past 8 branches the rest collapse into one
grouped "and N more" branch, so a 50-person payout still reads (12 was tried in the browser
walkthrough and the labels crowded).

**Trust boundary.** Verified: amounts and purposes on the receipt are read back from Arc. Checked
but can change: "can receive" is a probe at check time, and the payment can still be refused if an
address is blocked later; the receipt then says nothing was sent. Simulated: the demo card. Not
available: bank or mobile money, shown as "Coming soon", never as a working option.

**Layout.** Container widens from 64rem to 75rem. Home on desktop is two columns, about 7/5: wallet
panel and activity on the left (the things that change), splits, the automatic split and starting
points on the right (the things you reuse). Phone order: wallet, actions, splits, activity, with a
bottom bar for Home, Pay and Profile.

**States per flow.** Review table: ready, invalid, duplicate, your own wallet, can't receive,
wallet setup failed. Approval: list changed or expired ("Check it again"), list already paid,
demo top-ups used up, not enough balance. Activity: loading, empty, received list unavailable
(sent items still shown). Copy: copied confirmation in place, with a screen-reader status.

**Motion additions.** Review rows settle in once per check, staggered and capped at 0.3s, never
on each keystroke. A row's status mark cross-fades when it changes. Add money is a dialog that
rises from the bottom on a phone and centres on desktop. Copy swaps its icon for a tick. All of it
is off under reduced motion.

**Rejected.** A separate Giveaway section (it duplicates Pay and splits the vocabulary). CSV upload
(pasting covers it, and works on a phone). Claim links for email recipients (signing in is the
claim; a link is one more thing to phish). Showing bank payout as a disabled form (it implies it
nearly works).

## v2 visual direction (2026-10-11): "Adire and colour blocks"

The user asked for modern fills and motion instead of a generic AI look. The direction comes from
the subject: money sent home to Nigeria, divided by purpose.

- **Indigo as the base fill.** Adire cloth is Yoruba indigo-dyed fabric. A deep indigo is the
  brand fill for the wallet, the main button and the "trunk" of every payment.
- **Colour blocks for purposes.** Each part of a split gets its own flat, saturated fill, in the
  spirit of the colour blocking in wax-print fabric (no literal patterns). The colour follows the
  purpose everywhere: ribbon segment, avatar chip, tracker branch, receipt line.
- **One signature gesture: the split stream.** One indigo stream divides into coloured branches.
  It draws once on the sign-in hero, and on the payment screen it moves with the real payment
  state: the trunk fills while funding and approving, the branches draw while paying out, and each
  recipient's node fills when it's delivered. Nothing else on the page performs.

| Token | Hex | Use |
| --- | --- | --- |
| Indigo | `#1F1B4D` | brand fill, primary actions, trunk |
| Mist | `#EFF1F7` | page background (cool, not cream) |
| Marigold | `#F4B400` | purpose 1 |
| Leaf | `#12A26B` | purpose 2 |
| Hibiscus | `#E2367F` | purpose 3 |
| Lagoon | `#2F7CF6` | purpose 4 |
| Lilac | `#9A7CF6` | purpose 5 |
| Lime | `#A9C934` | purpose 6 |

Type: Bricolage Grotesque for figures and headings (its numerals have character, and it scales
well at 56px and up); Hanken Grotesk for everything else. Tabular figures for amounts.

Layout: left-aligned on wide screens. Hierarchy shows in the radii: the indigo hero gets 28px,
cards 20px, controls 14px, chips fully round. No uniform grey shadow under everything: cards sit on
the mist background with a 1px indigo-tinted ring and lift only when they're actionable.

Motion map:

| Moment | Treatment |
| --- | --- |
| Sign-in load | the stream draws and splits once (about 1.4s) |
| Builder typing | ribbon segments spring to their new widths as percentages change |
| Amounts changing | numbers count to the new value (about 0.6s) |
| Dialog | springs up from slightly below; the backdrop fades |
| Press | buttons scale to 0.98 |
| Payment progress | the stream follows server state, with nodes filling one by one on delivery |
| Reduced motion | everything jumps to its final state |

Checked against the common defaults and rejected: cream background with a terracotta accent (the
background is cool mist, and there's no terracotta), near-black with one acid accent (indigo
carries many purpose colours), identical grey-shadow cards, all-caps eyebrows, middle-dot meta
strings, arrows appended to links, and fade-up on every section. Earlier screens used some of
these and v2 removes them.

---

v1, 2026-10-11. The direction is set by the user's reference: a quiet white canvas, one soft-shadowed
card, a large figure, and a nested panel with the people the money goes to. It may change.

## Users and job

A sender abroad (UK, US) who supports family at home every month. They know exactly what each part
of the money is for. The job: send once, have it land already divided, and be able to show
where it went. They aren't crypto users and shouldn't need to be.

## Meaning, contract, focal object

- **Meaning:** the money you send arrives already divided, each part doing the job you gave it.
- **Emotional contract:** after the first payment the sender feels in control and calm. It would
  feel false if an amount looked estimated without saying so, or if the simulated card step were
  presented as a real card charge.
- **Focal object:** the split card. It shows the total in a large figure, and the people it reaches
  as a stack of faces or initials. Later the panel gains purpose labels ("rent", "school fees").
- **Action hierarchy:** primary action is *Send through this split*. Supporting actions: create a
  split, view a payment's receipt. Secondary: pockets, automatic splits, security settings.

## Trust boundary

| Fact | How the UI says it |
| --- | --- |
| Per-recipient amounts | Exact, from the same rules the contract uses; shown before confirming |
| Card payment and FX | Labelled "Simulated card" until a real onramp is wired |
| USDC movement | Real in live mode; each payment links to its Arc explorer receipt |
| Payment progress | Step list driven by server state, never a timer |
| Preview mode | A visible "Preview" tag, so nobody mistakes it for live money |

## Component decisions (PaymentSummaryCard, `components/ui/card-3.tsx`)

Integrated from the user's reference with these changes, each with a reason:

- `amount` also accepts a decimal string. The API sends USDC as exact strings; converting to a JS
  number and back can show a wrong cent.
- Avatars can be initials instead of a photo. Recipients are people the sender names by email; the
  product has no photo of them. Stock faces would imply we know who the user's family is.
  Stock photos appear only on the `/demo/card` page.
- `+N` no longer renders a stray `0` when `moreCount` is 0 (`0 && …` renders "0" in React).
- The interactive panel is a real `<button>`, so it gets focus, Enter and Space, and a role for free.
  An `aria-label` combines title and subtitle.
- Avatar alt text is kept; initials circles are `aria-hidden` and the count is read in the label.
- Hover lifts the arrow circle (transform only). Reduced motion turns the transition off.

## Tokens

shadcn neutral palette on Tailwind v4 CSS variables, light first, with a dark set ready.
`--primary` is near-black, as in the reference's `+8` chip. One radius family (`rounded-2xl` for
cards, `rounded-xl` for nested panels, full for avatars and icon buttons). System UI font stack,
matching the reference.

## Screens and states (v1, 2026-10-11)

| Screen | Route | States covered |
| --- | --- | --- |
| Sign in | `/` | email, code, wrong or expired code, preview code shown, already signed in |
| Security | `/setup` | PIN create and repeat, trivial PIN refused, passkey offer, browser without passkeys |
| Home | `/home` | loading skeleton, empty ("Create your first split"), split setting up, split failed, payments in flight (pulsing dot), error with retry |
| New split | `/splits/new` | live 100% check, fixed plus percent, approval dialog, unapproved drafts hidden |
| Send | `/send/[id]` | card (simulated) or wallet balance, server-priced breakdown, limit and balance errors |
| Payment | `/payments/[id]` | live steps from server state, delivered, failed with the reason, receipt (simulated label in preview, explorer link live) |
| Automatic split | `/rules/new` | percent slider, pocket name, approval |

Approval dialog: native `<dialog>`, focus goes to the PIN, 6 digits auto-submit, wrong-PIN count,
lockout, expiry, and Face ID / fingerprint when a passkey exists.

Checked in a browser (2026-10-11, preview build served from the VPS): the full loop, from sign-in
and PIN through creating a split and paying £10 and £15 by simulated card to "Delivered". Also
checked at 375px with no horizontal scroll, touch targets of at least 44px, and the keyboard path
on the card and dialog.

Fixed from that pass: the PIN field wasn't focused when the dialog opened; there was a silent
3-second wait after approving (approval now answers at once and the tracker shows progress); each
recipient is now a labelled group for screen readers; placeholders differ per recipient; back
links and the logo were under 44px.

Not yet verified: Face ID / fingerprint on a real phone (the browser pane has no authenticator),
and the dark theme (tokens exist, not switched on).

## Rejected alternatives

- A dark crypto-dashboard look with charts and wallet addresses up front. It tells the wrong story
  for people who just want rent paid.
- Stock portraits as default avatars. Explained above.
