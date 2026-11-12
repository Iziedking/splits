import { describe, expect, it } from "vitest";
import { councilOf, createDaoTx, isDaoName, proposedShares, proposeTx, setSplitKind, voteTx, type Policy } from "./dao";

const ROUTER = "splits.kingizie.testnet";
const shares = [
  { account_id: "rent.flat.testnet", bps: 4000, purpose: "rent" },
  { account_id: "bills.flat.testnet", bps: 6000, purpose: "bills" },
];

describe("councilOf", () => {
  it("lists the members of every group that can approve, not everyone who can propose", () => {
    const policy: Policy = {
      roles: [
        { name: "all", kind: "Everyone", permissions: ["*:AddProposal"] },
        { name: "council", kind: { Group: ["ada.testnet", "bo.testnet"] }, permissions: ["*:Finalize", "*:AddProposal", "*:VoteApprove", "*:VoteReject"] },
      ],
      proposal_bond: "1000000000000000000000000",
      proposal_period: "604800000000000",
      default_vote_policy: { threshold: [1, 2] },
    };
    expect(councilOf(policy)).toEqual(["ada.testnet", "bo.testnet"]);
  });
});

describe("set_split proposals", () => {
  it("round-trips the shares through the proposal kind", () => {
    expect(proposedShares({ kind: setSplitKind(ROUTER, shares) }, ROUTER)).toEqual(shares);
  });

  it("ignores proposals that call anything else", () => {
    expect(proposedShares({ kind: setSplitKind("evil.testnet", shares) }, ROUTER)).toBeNull();
    expect(proposedShares({ kind: { Transfer: { receiver_id: "x.testnet", amount: "1" } } }, ROUTER)).toBeNull();
  });

  it("files the proposal with the DAO's own bond and a plain description", () => {
    const tx = proposeTx("flat.sputnikv2.testnet", ROUTER, shares, "1000000000000000000000000");
    expect(tx.receiverId).toBe("flat.sputnikv2.testnet");
    const params = tx.actions[0]!.params;
    expect(params.methodName).toBe("add_proposal");
    expect(params.deposit).toBe("1000000000000000000000000");
    expect((params.args as { proposal: { description: string } }).proposal.description).toBe(
      "Splits: divide the group's income 40% rent to rent.flat.testnet, 60% bills to bills.flat.testnet",
    );
  });

  it("votes with the proposal kind, as Sputnik 3.x requires", () => {
    const kind = setSplitKind(ROUTER, shares);
    const tx = voteTx("flat.sputnikv2.testnet", { id: 4, kind }, true);
    expect(tx.actions[0]!.params.args).toEqual({ id: 4, action: "VoteApprove", proposal: kind });
    expect(voteTx("flat.sputnikv2.testnet", { id: 4, kind }, false).actions[0]!.params.args.action).toBe("VoteReject");
  });
});

describe("founding a group", () => {
  it("asks the factory for a DAO whose council is the members", () => {
    const tx = createDaoTx("sputnikv2.testnet", "flatmates", "Rent and bills", ["ada.testnet", "bo.testnet"]);
    const args = tx.actions[0]!.params.args as { name: string; args: string };
    expect(args.name).toBe("flatmates");
    expect(JSON.parse(Buffer.from(args.args, "base64").toString())).toEqual({
      config: { name: "flatmates", purpose: "Rent and bills", metadata: "" },
      policy: ["ada.testnet", "bo.testnet"],
    });
  });

  it("accepts only names the factory can make", () => {
    expect(isDaoName("flat-mates_2")).toBe(true);
    expect(isDaoName("Flat")).toBe(false);
    expect(isDaoName("a")).toBe(false);
    expect(isDaoName("a.b")).toBe(false);
  });
});
