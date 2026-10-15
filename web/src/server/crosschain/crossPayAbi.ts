/** SplitsCrossPay (contracts/src/SplitsCrossPay.sol): what the app calls and reads. */
export const crossPayAbi = [
  { type: "function", name: "relay", stateMutability: "nonpayable", inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "owed", stateMutability: "view", inputs: [{ name: "payer", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "usdc", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "transmitter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "router", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenMessenger", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "routerRef",
    stateMutability: "pure",
    inputs: [{ name: "sourceDomain", type: "uint32" }, { name: "payer", type: "address" }, { name: "ref", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "event",
    name: "CrossPaid",
    inputs: [
      { name: "ref", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "sourceDomain", type: "uint32", indexed: false },
      { name: "payAmount", type: "uint256", indexed: false },
      { name: "feeBack", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Refunded",
    inputs: [
      { name: "ref", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "reason", type: "uint8", indexed: false },
    ],
  },
  { type: "event", name: "Owed", inputs: [{ name: "payer", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "Claimed", inputs: [{ name: "payer", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
] as const;
