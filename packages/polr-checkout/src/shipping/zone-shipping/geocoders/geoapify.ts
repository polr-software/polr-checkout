import type { NormalizedAddress } from "../../../providers/provider";

export interface Geocoder {
  geocode(address: NormalizedAddress): Promise<{ lat: number; lng: number } | null>;
}

export interface GeoapifyOptions {
  apiKey: string;
  /** Optional bias for the search, e.g. "countrycode:pl". */
  bias?: string;
  /** Override the base URL (mainly for tests). */
  apiUrl?: string;
}

interface GeoapifyResponse {
  features?: Array<{
    properties?: {
      lat?: number;
      lon?: number;
    };
  }>;
}

/** Geoapify forward-geocode adapter. Used by `zoneShipping` to map an address
 *  to coordinates when the caller doesn't supply them. */
export function geoapify(options: GeoapifyOptions): Geocoder {
  const apiUrl = options.apiUrl ?? "https://api.geoapify.com/v1/geocode/search";

  return {
    async geocode(address) {
      const params = new URLSearchParams({
        text: [address.line1, address.postalCode, address.city, address.country].filter(Boolean).join(", "),
        format: "geojson",
        limit: "1",
        apiKey: options.apiKey,
      });
      if (options.bias) params.set("bias", options.bias);

      const response = await fetch(`${apiUrl}?${params.toString()}`);
      if (!response.ok) return null;

      const data = (await response.json()) as GeoapifyResponse;
      const feature = data.features?.[0];
      const lat = feature?.properties?.lat;
      const lon = feature?.properties?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") return null;
      return { lat, lng: lon };
    },
  };
}
