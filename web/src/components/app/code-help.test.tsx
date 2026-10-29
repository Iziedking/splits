import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HELP_ANSWERS } from "@/lib/support";
import { CodeHelp, RESEND_WAIT_S } from "./code-help";

const help = (over: Partial<Parameters<typeof CodeHelp>[0]> = {}) =>
  renderToStaticMarkup(<CodeHelp email="ada@example.com" secondsLeft={0} sending={false} sentAgain={false} onResend={() => {}} onChangeEmail={() => {}} {...over} />);

describe("when the code doesn't arrive", () => {
  it("offers a new code and a way to fix the email", () => {
    const out = help();
    expect(out).toContain("Send a new code");
    expect(out).toContain("Wrong email? Change it");
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Send a new code/);
  });

  it("waits 30 seconds between codes, and says how long is left", () => {
    expect(RESEND_WAIT_S).toBe(30);
    const out = help({ secondsLeft: 12 });
    expect(out).toContain("Send a new code in 12s");
    expect(out).toMatch(/<button[^>]*disabled=""/);
  });

  it("says a new code went out, to which address", () => {
    expect(help({ sentAgain: true })).toContain("A new code is on its way to ada@example.com. Use the newest one.");
  });

  it("is what Help points to", () => {
    const a = HELP_ANSWERS.find((x) => x.q === "Didn't get your sign-in code?")!.a;
    expect(a).toContain("Send a new code");
    expect(a).toContain("Wrong email? Change it");
  });
});
