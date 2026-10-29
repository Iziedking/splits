import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FundingChoice, FundingToggle } from "./funding-choice";

const noop = () => undefined;

describe("the funding choice", () => {
  it("renders nothing when the test card is off, so the screen pays from the balance", () => {
    expect(renderToStaticMarkup(<FundingChoice demoCard={false} value="balance" onChange={noop} balance="12.00" balanceCovers />)).toBe("");
    expect(renderToStaticMarkup(<FundingToggle demoCard={false} value="balance" onChange={noop} balance="12.00" />)).toBe("");
  });

  it("offers the balance and the test card where the card is on, without demo or simulated wording", () => {
    const choice = renderToStaticMarkup(<FundingChoice demoCard value="balance" onChange={noop} balance="12.00" balanceCovers />);
    expect(choice.match(/role="radio"/g)).toHaveLength(2);
    expect(choice).toContain("Balance");
    expect(choice).toContain("Test card");
    expect(choice).not.toMatch(/demo card|simulated/i);

    const toggle = renderToStaticMarkup(<FundingToggle demoCard value="card" onChange={noop} balance="12.00" />);
    expect(toggle.match(/role="radio"/g)).toHaveLength(2);
    expect(toggle).toContain("Balance, $12.00");
    expect(toggle).not.toMatch(/wallet/i);
  });

  it("disables the balance when it does not cover the total", () => {
    const html = renderToStaticMarkup(<FundingChoice demoCard value="card" onChange={noop} balance="1.00" balanceCovers={false} />);
    expect(html).toContain("$1.00, not enough");
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });
});
