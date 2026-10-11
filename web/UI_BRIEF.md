# Splits UI brief

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
