"use client";

import { Download, FileUp } from "lucide-react";
import * as React from "react";
import { Notice } from "@/components/ui/field";
import { batches, parsePayrollCsv, PAYROLL_TEMPLATE } from "@/lib/near/csv";
import { MAX_LEGS, type Line } from "@/lib/near/payment";
import { cn } from "@/lib/utils";
import { download } from "./download";
import { SendFlow } from "./send-flow";

/**
 * Payroll from a CSV: upload people, amounts and purposes, then pay them through the same check and
 * one approval as a typed list. A payment holds at most MAX_LEGS people, so longer files are paid
 * in batches, one approval each. After each payment, the result offers a CSV of what landed.
 */
export function PayrollFlow() {
  const [file, setFile] = React.useState<{ name: string; lines: Line[]; problems: string[] } | null>(null);
  const [batch, setBatch] = React.useState(0);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 200_000) {
      setFile({ name: f.name, lines: [], problems: ["That file is too large for a payroll. Keep it under 200 KB."] });
      return;
    }
    const parsed = parsePayrollCsv(await f.text());
    setFile({ name: f.name, ...parsed });
    setBatch(0);
  }

  const groups = file ? batches(file.lines) : [];
  const current = groups[batch];

  return (
    <div className="space-y-6">
      <section aria-labelledby="upload-title" className="surface rounded-2xl p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="upload-title" className="text-lg font-semibold">
              Upload a CSV
            </h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Three columns: <span className="font-mono text-[0.8125rem]">account</span>, <span className="font-mono text-[0.8125rem]">amount</span> and{" "}
              <span className="font-mono text-[0.8125rem]">purpose</span>. A header row is optional, and the columns can be in any order when it has one.
            </p>
          </div>
          <button
            type="button"
            onClick={() => download("splits-payroll-template.csv", PAYROLL_TEMPLATE)}
            className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-primary-text transition-colors hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Download a template
          </button>
        </div>

        <label
          htmlFor="payroll-file"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files[0]);
          }}
          className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-foreground/12 bg-white/50 px-6 py-10 text-center transition-colors hover:border-primary/50 hover:bg-white/70 focus-within:ring-2 focus-within:ring-primary"
        >
          <FileUp className="h-6 w-6 text-primary-text" strokeWidth={1.75} aria-hidden="true" />
          <span className="font-medium">{file ? file.name : "Choose a CSV file, or drop it here"}</span>
          <span className="text-sm text-muted-foreground">{file && !file.problems.length ? `${file.lines.length} people` : "Nothing is paid until you check the list and approve it"}</span>
          <input
            id="payroll-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>

        {file?.problems.map((p) => (
          <Notice key={p} tone="error" className="mt-3">
            {p}
          </Notice>
        ))}

        {groups.length > 1 && (
          <div className="mt-5">
            <p className="text-sm text-muted-foreground">
              A payment holds at most {MAX_LEGS} people, so this payroll is paid in {groups.length} parts, one approval each.
            </p>
            <div aria-label="Payroll parts" role="group" className="mt-3 flex flex-wrap gap-2">
              {groups.map((g, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={i === batch}
                  onClick={() => setBatch(i)}
                  className={cn(
                    "min-h-10 rounded-full px-4 text-sm font-medium ring-1 transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                    i === batch ? "bg-primary-fill text-white ring-primary-fill" : "bg-white/60 text-muted-foreground ring-foreground/10 hover:text-foreground",
                  )}
                >
                  Part {i + 1}: rows {i * MAX_LEGS + 1} to {i * MAX_LEGS + g.length}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {current && current.length > 0 && <SendFlow key={`${file?.name}-${batch}`} initial={current} />}
    </div>
  );
}
