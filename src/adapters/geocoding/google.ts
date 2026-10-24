import { config } from "../../config";
import { retry } from "../../utils/retry";
import {
  GeocodingProviderUnavailable,
  type GeocodedCoordinates,
  type GeocodingInput,
  type GeocodingProvider,
} from "./geocoding-provider";

const TIMEOUT_MS = 5_000;

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type GoogleGeocodingAdapterOptions = {
  apiKey?: string;
  request?: Fetch;
};

type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: {
    geometry?: {
      location?: { lat?: unknown; lng?: unknown };
      location_type?: string;
    };
    formatted_address?: string;
  }[];
};

export class GoogleGeocodingAdapter implements GeocodingProvider {
  readonly name = "Google Maps";

  private readonly apiKey?: string;
  private readonly request: Fetch;

  // Creates an adapter with optional test dependencies.
  constructor(options: GoogleGeocodingAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.request = options.request ?? fetch;
  }

  // Resolves one address, retrying when Google can't be reached or answers with an error.
  geocodeAddress(input: GeocodingInput): Promise<GeocodedCoordinates | null> {
    return retry(() => this.geocodeOnce(input), { retryOn: (error) => error instanceof GeocodingProviderUnavailable });
  }

  // Resolves one address through the Google Geocoding API. An area-level match is refused unless
  // the caller allows it.
  private async geocodeOnce(input: GeocodingInput): Promise<GeocodedCoordinates | null> {
    const url = new URL(config().GOOGLE_GEOCODING_URL);
    url.search = new URLSearchParams({
      address: input.address,
      components: `country:${input.countryCode.toUpperCase()}`,
      key: this.apiKey ?? config().GOOGLE_MAPS_API_KEY ?? "",
    }).toString();

    let response: Response;

    try {
      response = await this.request(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new GeocodingProviderUnavailable("Google Maps could not be reached");
    }

    if (!response.ok) {
      throw new GeocodingProviderUnavailable(`Google Maps returned HTTP ${response.status}`);
    }

    const body = await response.json().catch(
      // Treats a non-JSON response as an invalid provider response.
      () => null,
    ) as GoogleGeocodeResponse | null;

    if (body?.status === "ZERO_RESULTS") return null;
    if (body?.status !== "OK") {
      // REQUEST_DENIED (bad key or billing), OVER_QUERY_LIMIT, INVALID_REQUEST and UNKNOWN_ERROR.
      throw new GeocodingProviderUnavailable(`Google Maps returned ${body?.status ?? "an invalid response"}`);
    }

    const result = body.results?.[0];
    const geometry = result?.geometry;
    if (!geometry) return null;
    // An APPROXIMATE match is a whole area. No store pin is better than a misleading one, but a
    // delivery quote can price from it.
    const approximate = geometry.location_type === "APPROXIMATE";
    if (approximate && !input.allowArea) return null;

    const { lat, lng } = geometry.location ?? {};
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new GeocodingProviderUnavailable("Google Maps returned invalid coordinates");
    }

    return approximate ? { latitude: lat, longitude: lng, area: areaName(result.formatted_address) } : { latitude: lat, longitude: lng };
  }
}

// Shortens Google's "Sangotedo 106104, Lagos, Nigeria" to "Sangotedo, Lagos": no postcode or country.
function areaName(formatted: string | undefined) {
  const parts = (formatted ?? "").split(",").map((part) => part.replace(/\s*\d{4,}/g, "").trim()).filter(Boolean);
  return (parts.length > 1 ? parts.slice(0, -1) : parts).join(", ") || "that area";
}
