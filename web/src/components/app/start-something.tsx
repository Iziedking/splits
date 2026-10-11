import Link from "next/link";
import { Ribbon } from "@/components/app/ribbon";

const STARTERS = [
  {
    href: "/splits/new?template=family",
    title: "Family support",
    body: "Rent, school fees and upkeep, sent home in one payment every month.",
    parts: [
      { label: "Rent", weight: 40 },
      { label: "School fees", weight: 35 },
      { label: "Upkeep", weight: 25 },
    ],
  },
  {
    href: "/pay?mode=many&template=giveaway",
    title: "Giveaway or prizes",
    body: "Paste the winners and pay everyone at once, from $1 to a whole pot.",
    parts: Array.from({ length: 8 }, (_, i) => ({ label: `Winner ${i + 1}`, weight: 1 })),
  },
  {
    href: "/splits/new?template=team",
    title: "Team or revenue share",
    body: "Split what comes in between partners or collaborators, the same way every time.",
    parts: [
      { label: "Partner A", weight: 50 },
      { label: "Partner B", weight: 50 },
    ],
  },
] as const;

/** Starting points for the common reasons people split money. Family support comes first. */
export function StartSomething() {
  return (
    <section aria-labelledby="start-heading">
      <h2 id="start-heading" className="mb-4 text-xl font-bold">
        Start something new
      </h2>
      <ul className="grid gap-3">
        {STARTERS.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="surface block p-4 transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgb(31_27_77/0.45)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <Ribbon parts={[...s.parts]} height={8} />
              <span className="mt-3 block font-semibold">{s.title}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{s.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
