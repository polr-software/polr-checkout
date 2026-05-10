import type { ShippingInput, ShippingResolver, ShippingResult } from "./shipping";

export interface CustomShippingOptions {
  resolve: (input: ShippingInput) => Promise<ShippingResult | null> | ShippingResult | null;
}

/** Drop in a fully custom shipping resolver. */
export function customShipping(options: CustomShippingOptions): ShippingResolver {
  return {
    async resolve(input) {
      return options.resolve(input);
    },
  };
}
