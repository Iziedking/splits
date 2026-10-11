# Splits UI brief

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

## States still to design with the app screens

Loading (skeleton figure and avatar circles), empty (no splits yet: one action, "Create your first
split"), error (keep the card and say what failed), unauthorized (redirect to sign-in), and
pending onchain (the split card shows "Setting up" until the contract confirms it).

## Rejected alternatives

- A dark crypto-dashboard look with charts and wallet addresses up front. It tells the wrong story
  for people who just want rent paid.
- Stock portraits as default avatars. Explained above.
