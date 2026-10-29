"use client";

import { useState } from "react";
import { PaymentSummaryCard, type Avatar } from "@/components/ui/card-3";

const photo = (id: string) => `https://images.unsplash.com/${id}?w=96&h=96&fit=crop&crop=faces&auto=format`;

// The reference look, with stock portraits. Demo only: the app uses initials (UI_BRIEF.md).
const referenceAvatars: Avatar[] = [
  { src: photo("photo-1494790108377-be9c29b29330"), alt: "Recipient 1" },
  { src: photo("photo-1507003211169-0a1dd7228f2d"), alt: "Recipient 2" },
  { src: photo("photo-1500648767791-00dcc994a43e"), alt: "Recipient 3" },
];

// How Splits uses it: one split, its recipients by initials, the exact USDC total.
const familyAvatars: Avatar[] = [
  { initials: "LL", alt: "Landlord" },
  { initials: "SC", alt: "School" },
  { initials: "SI", alt: "Sister" },
];

export default function CardDemo() {
  const [opened, setOpened] = useState<string | null>(null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-4 md:flex-row">
      <PaymentSummaryCard
        title="Payment Templates"
        amount={486.32}
        currency="$"
        subCardTitle="Mandatory payments"
        subCardSubtitle="Essential dues"
        avatars={referenceAvatars}
        moreCount={8}
        onSubCardClick={() => setOpened("Mandatory payments")}
      />
      <PaymentSummaryCard
        title="Sent this month"
        amount="12.70"
        currency="$"
        subCardTitle="Family in Lagos"
        subCardSubtitle="Rent, school fees, upkeep"
        avatars={familyAvatars}
        moreCount={0}
        onSubCardClick={() => setOpened("Family in Lagos")}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {opened ? `Opened ${opened}` : ""}
      </p>
      {opened && (
        <p className="fixed bottom-6 rounded-full bg-primary-fill px-4 py-2 text-sm text-primary-foreground">
          Opened {opened}
        </p>
      )}
    </main>
  );
}
