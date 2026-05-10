import type { ShippingInput, ShippingResolver, ShippingResult } from "../shipping";
import type { Geocoder } from "./geocoders/geoapify";
import { isPointInPolygon, type Polygon } from "./point-in-polygon";

export interface ZoneShippingZone {
  id: string | number;
  name: string;
  amount: number;
  /**
   * Either a GeoJSON Polygon/MultiPolygon `geometry`, or a raw coordinate
   * `[ring, ...]` polygon. Coordinates are `[lng, lat]` as per GeoJSON.
   */
  geometry: ZoneGeometry;
}

export type ZoneGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | Polygon;

export interface ZoneShippingOptions {
  zones: readonly ZoneShippingZone[];
  geocoder?: Geocoder;
  /**
   * What to do when the address falls outside every zone.
   * - `"reject"` — return a non-deliverable `ShippingResult` (default)
   * - `"fallback"` — return the configured `fallback` rate
   */
  onOutOfZone?: "reject" | "fallback";
  fallback?: { amount: number; label: string };
}

interface NormalizedZone {
  id: string | number;
  name: string;
  amount: number;
  polygons: Polygon[];
}

/** Address -> zone resolver. Pairs well with a delivery-area GeoJSON. */
export function zoneShipping(options: ZoneShippingOptions): ShippingResolver {
  const onOutOfZone = options.onOutOfZone ?? "reject";
  const normalized = options.zones.map(normalizeZone);

  return {
    async resolve(input: ShippingInput): Promise<ShippingResult | null> {
      const point = await resolveCoordinates(input, options.geocoder);
      if (!point) {
        return outOfZone(options, onOutOfZone);
      }

      for (const zone of normalized) {
        if (zone.polygons.some((poly) => isPointInPolygon(point, poly))) {
          return {
            amount: zone.amount,
            label: zone.name,
            zoneId: zone.id,
            deliverable: true,
          };
        }
      }

      return outOfZone(options, onOutOfZone);
    },
  };
}

function outOfZone(
  options: ZoneShippingOptions,
  mode: "reject" | "fallback",
): ShippingResult {
  if (mode === "fallback" && options.fallback) {
    return {
      amount: options.fallback.amount,
      label: options.fallback.label,
      deliverable: true,
    };
  }
  return {
    amount: 0,
    label: "Out of delivery area",
    deliverable: false,
  };
}

async function resolveCoordinates(
  input: ShippingInput,
  geocoder: Geocoder | undefined,
): Promise<[number, number] | null> {
  if (input.coordinates) {
    return [input.coordinates.lng, input.coordinates.lat];
  }
  if (input.address && geocoder) {
    const located = await geocoder.geocode(input.address);
    if (!located) return null;
    return [located.lng, located.lat];
  }
  return null;
}

function normalizeZone(zone: ZoneShippingZone): NormalizedZone {
  return {
    id: zone.id,
    name: zone.name,
    amount: zone.amount,
    polygons: toPolygons(zone.geometry),
  };
}

function toPolygons(geometry: ZoneGeometry): Polygon[] {
  if (Array.isArray(geometry)) {
    return [geometry as Polygon];
  }
  const tagged = geometry as { type: string; coordinates: unknown };
  if (tagged.type === "Polygon") {
    return [tagged.coordinates as Polygon];
  }
  return (tagged.coordinates as Polygon[]).map((p) => p);
}

export { isPointInPolygon } from "./point-in-polygon";
