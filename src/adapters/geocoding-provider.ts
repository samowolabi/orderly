export class GeocodingProviderUnavailable extends Error {}

export type GeocodingInput = {
  address: string;
  countryCode: string;
};

export type GeocodedCoordinates = {
  latitude: number;
  longitude: number;
};

export interface GeocodingProvider {
  readonly name: string;

  // Converts one postal address into a map coordinate pair.
  geocodeAddress(input: GeocodingInput): Promise<GeocodedCoordinates | null>;
}
