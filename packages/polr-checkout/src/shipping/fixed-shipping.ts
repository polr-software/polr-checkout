import type { ShippingResolver, ShippingResult } from "./shipping";

export interface FixedShippingOptions {
  amount: number;
  label?: string;
}

/** Flat shipping rate independent of address. */
export function fixedShipping(options: FixedShippingOptions): ShippingResolver {
  const label = options.label ?? "Shipping";
  return {
    async resolve(): Promise<ShippingResult> {
      return {
        amount: options.amount,
        label,
        deliverable: true,
      };
    },
  };
}
