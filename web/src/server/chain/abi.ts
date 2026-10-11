import { parseAbi } from "viem";

/** Hand-written to match contracts/src/SplitsRouter.sol; abi.test.ts compares it with the build. */
export const splitsRouterAbi = parseAbi([
  "struct Leg { address recipient; uint96 fixedAmount; uint16 shareBps; bytes32 purpose; }",
  "function createSplit(Leg[] legs) returns (uint256 splitId)",
  "function updateSplit(uint256 splitId, Leg[] legs) returns (uint32 version)",
  "function setActive(uint256 splitId, bool active)",
  "function send(uint256 splitId, uint32 expectedVersion, uint256 amount, bytes32 ref) returns (uint256[] amounts)",
  "function pay(Leg[] legs, uint256 amount, bytes32 ref) returns (uint256[] amounts)",
  "function previewPay(Leg[] legs, uint256 amount) view returns (uint256[])",
  "function getSplit(uint256 splitId) view returns (address owner, uint32 version, bool active, Leg[] legs)",
  "function previewSend(uint256 splitId, uint256 amount) view returns (uint256[])",
  "function refUsed(address payer, bytes32 ref) view returns (bool)",
  "function nextSplitId() view returns (uint256)",
  "function usdc() view returns (address)",
  "event SplitCreated(uint256 indexed splitId, address indexed owner)",
  "event SplitLegsSet(uint256 indexed splitId, uint32 version, Leg[] legs)",
  "event SplitActiveSet(uint256 indexed splitId, bool active)",
  "event SplitSent(uint256 indexed splitId, address indexed payer, bytes32 indexed ref, uint256 amount, uint32 version)",
  "event LegPaid(uint256 indexed splitId, bytes32 indexed ref, address indexed recipient, uint256 amount, bytes32 purpose)",
]);
