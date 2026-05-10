import type { NormalizedAddress } from "../providers/provider";

export interface ShippingInput {
  address?: NormalizedAddress | null;
  coordinates?: { lat: number; lng: number } | null;
  cart?: ReadonlyArray<{ id?: string; quantity: number; unitAmount: number }>;
}

export interface ShippingResult {
  amount: number;
  label: string;
  zoneId?: string | number;
  deliverable: boolean;
}

export interface ShippingResolver {
  resolve(input: ShippingInput): Promise<ShippingResult | null>;
}
