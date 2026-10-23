import { config } from "../../config";
import {
  GeocodingProviderUnavailable,
  type GeocodedCoordinates,
  type GeocodingInput,
  type GeocodingProvider,
} from "./geocoding-provider";

const GEOCODING_URL = "https://api.geoapify.com/v1/geocode/search";
const TIMEOUT_MS = 5_000;

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type GeoapifyAdapterOptions = {
  apiKey?: string;
  request?: Fetch;
};

export class GeoapifyAdapter implements GeocodingProvider {
  readonly name = "Geoapify";

  private readonly apiKey?: string;
  private readonly request: Fetch;

  // Creates an adapter with optional test dependencies.
  constructor(options: GeoapifyAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.request = options.request ?? fetch;
  }

  // Resolves one address through Geoapify's forward-geocoding endpoint.
  async geocodeAddress(input: GeocodingInput): Promise<GeocodedCoordinates | null> {
    const url = new URL(GEOCODING_URL);
    url.search = new URLSearchParams({
      text: input.address,
      format: "json",
      limit: "1",
      filter: `countrycode:${input.countryCode.toLowerCase()}`,
      apiKey: this.apiKey ?? config().GEOAPIFY_API_KEY ?? "",
    }).toString();

    let response: Response;

    try {
      response = await this.request(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GeocodingProviderUnavailable("Geoapify could not be reached");
    }

    if (!response.ok) {
      throw new GeocodingProviderUnavailable(`Geoapify returned HTTP ${response.status}`);
    }

    const body = (await response.json().catch(
      // Treats a non-JSON response as an invalid provider response.
      () => null,
    )) as { results?: { lat?: unknown; lon?: unknown; rank?: { confidence?: unknown } }[] } | null;
    const result = body?.results?.[0];
    // Below 0.5 Geoapify is often matching a different building; no pin beats a wrong one.
    if (result && typeof result.rank?.confidence === "number" && result.rank.confidence < 0.5) return null;
    if (!result) return null;

    if (
      typeof result.lat !== "number" ||
      typeof result.lon !== "number" ||
      !Number.isFinite(result.lat) ||
      !Number.isFinite(result.lon) ||
      result.lat < -90 ||
      result.lat > 90 ||
      result.lon < -180 ||
      result.lon > 180
    ) {
      throw new GeocodingProviderUnavailable("Geoapify returned invalid coordinates");
    }

    return { latitude: result.lat, longitude: result.lon };
  }
}
