import type { ButtonConfig } from "./button";

/**
 * The demo shop on near.mysplits.xyz/shop: one product and a "Pay with Splits" button. Each sale
 * divides between the farm that supplied the beans, the shop's tax pot and the staff tip jar. The
 * three accounts were made from the public testnet faucet and registered for testnet USDC by
 * near/proof/demo-shop-accounts.mjs; nobody holds their keys, so the money there is just a record.
 */
export const DEMO_SHOP: ButtonConfig = {
  shop: "Kofi & Co. Coffee",
  item: "House blend, 250 g",
  amount: 1_000_000n, // 1.00 USDC
  parts: [
    { account: "splits-demo-farm.testnet", bps: 7000, purpose: "supplier: the farm that grew it" },
    { account: "splits-demo-taxpot.testnet", bps: 2000, purpose: "sales tax pot" },
    { account: "splits-demo-tipjar.testnet", bps: 1000, purpose: "staff tip jar" },
  ],
};
