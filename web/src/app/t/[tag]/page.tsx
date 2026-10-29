import type { Metadata } from "next";
import Link from "next/link";
import { InfoShell } from "@/components/app/info-shell";
import { MoneyNotice } from "@/components/app/money-notice";
import { TagPayCard } from "@/components/app/tag-pay-card";
import { userForSession } from "@/server/auth/sessions";
import { getCtx } from "@/server/context";
import { tagFromPath, tagProblem } from "@/server/domain/tags";
import { sessionToken } from "@/server/http";
import { tagPageData } from "@/server/services/tags";

type Props = { params: Promise<{ tag: string }> };

/** For sharing, not for search engines: indexed, these pages would list every account. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tag = tagFromPath((await params).tag);
  // Only a well-formed tag reaches the title, so a crafted link can't put its own words in the tab.
  return { title: tagProblem(tag) === "format" ? "Split tag not found" : `Pay @${tag}`, robots: { index: false, follow: false } };
}

/** mysplits.xyz/@ada (rewritten here by next.config): pay a Split tag, signed in or not. */
export default async function TagPage({ params }: Props) {
  const ctx = await getCtx();
  const raw = (await params).tag;
  const [data, user] = await Promise.all([tagPageData(ctx, raw), userForSession(ctx.db, await sessionToken(), ctx.now()).catch(() => null)]);
  return (
    <InfoShell signedIn={Boolean(user)}>
      <div className="enter mx-auto max-w-md space-y-6">
        {data ? (
          <TagPayCard tag={data.tag} signedIn={Boolean(user)} pageUrl={`${ctx.appUrl.replace(/\/+$/, "")}/@${data.tag}`} />
        ) : (
          <section className="surface space-y-3 p-6">
            <h1 className="text-title leading-tight font-extrabold break-all">No Splits account uses @{tagFromPath(raw).slice(0, 20)}</h1>
            <p className="text-muted-foreground">Check the tag with the person who shared it.</p>
            <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-primary-text underline underline-offset-4">
              Go to Splits
            </Link>
          </section>
        )}
        <MoneyNotice />
      </div>
    </InfoShell>
  );
}
