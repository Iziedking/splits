/**
 * Stand-in for Coinbase's optional x402 packages, which the Base Account connector inside wagmi
 * imports. Splits never makes x402 payments, so they are not installed. Every name they would
 * export is here, and using any of them throws; merely loading the connector does not.
 */
function absent(): never {
  throw new Error("x402 payments are not part of Splits");
}

export class x402Client {
  constructor() {
    absent();
  }
}
export class ExactEvmScheme {
  constructor() {
    absent();
  }
}
export class UptoEvmScheme {
  constructor() {
    absent();
  }
}
export class ExactSvmScheme {
  constructor() {
    absent();
  }
}
export const registerExactEvmScheme = absent;
export const toClientEvmSigner = absent;
