"use client";

import * as React from "react";
import { ActivityList } from "@/components/app/activity-list";
import { AppFrame } from "@/components/app/app-frame";
import { api, type ActivityView, type SplitView } from "@/lib/api";

export default function HistoryPage() {
  return (
    <AppFrame>
      <History />
    </AppFrame>
  );
}

/**
 * Every payment sent and received, newest first, in pages (UI_BRIEF.md v5: the rail's History).
 * Home shows only the latest few and links here.
 */
function History() {
  const [activity, setActivity] = React.useState<ActivityView | null>(null);
  const [splitNames, setSplitNames] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    try {
      const [a, s] = await Promise.all([api<ActivityView>("/api/activity"), api<{ splits: SplitView[] }>("/api/splits")]);
      setActivity(a);
      setSplitNames(Object.fromEntries(s.splits.map((sp) => [sp.id, sp.name])));
    } catch {
      // A failed load shows the empty-state loader's retry through ActivityList's own error path.
      setActivity({ sent: [], received: [], receivedError: "Couldn't load your history. Try again." });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="enter space-y-6 pt-4">
      <div>
        <h1 className="text-title leading-tight font-extrabold">History</h1>
        <p className="mt-1 text-muted-foreground">Everything you sent and received, each with its receipt.</p>
      </div>
      <ActivityList activity={activity} splitNames={splitNames} onRetry={() => void load()} />
    </div>
  );
}
