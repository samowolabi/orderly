export class GeocodingProviderUnavailable extends Error {}

export type GeocodingInput = {
  address: string;
  countryCode: string;
  // Accept a match for a whole area. A delivery quote can price from it; a store's map pin can't.
  allowArea?: boolean;
};

export type GeocodedCoordinates = {
  latitude: number;
  longitude: number;
  // Set when only an area matched, e.g. "Sangotedo, Lagos".
  area?: string;
};

export interface GeocodingProvider {
  readonly name: string;

  // Converts one postal address into a map coordinate pair.
  geocodeAddress(input: GeocodingInput): Promise<GeocodedCoordinates | null>;
}
