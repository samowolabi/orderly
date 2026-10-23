import { config } from "../../config";
import { RoutingProviderUnavailable, type Coordinates, type DrivingRoute, type RoutingProvider } from "./routing-provider";

const TIMEOUT_MS = 8_000;

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type GoogleRoutesResponse = {
  routes?: { distanceMeters?: number; duration?: string }[];
};

// Converts one point into the Routes API waypoint shape.
const waypoint = (point: Coordinates) => ({ location: { latLng: { latitude: point.latitude, longitude: point.longitude } } });

export class GoogleRoutesAdapter implements RoutingProvider {
  readonly name = "Google Maps";

  private readonly apiKey?: string;
  private readonly request: Fetch;

  // Creates an adapter with optional test dependencies.
  constructor(options: { apiKey?: string; request?: Fetch } = {}) {
    this.apiKey = options.apiKey;
    this.request = options.request ?? fetch;
  }

  // Asks the Google Routes API for the traffic-aware driving route between two points.
  async drivingRoute(origin: Coordinates, destination: Coordinates): Promise<DrivingRoute | null> {
    let response: Response;
    try {
      response = await this.request(config().GOOGLE_ROUTES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": this.apiKey ?? config().GOOGLE_MAPS_API_KEY ?? "",
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify({
          origin: waypoint(origin),
          destination: waypoint(destination),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new RoutingProviderUnavailable("Google Maps could not be reached");
    }
    if (!response.ok) throw new RoutingProviderUnavailable(`Google Maps returned HTTP ${response.status}`);

    const body = (await response.json().catch(
      // Treats a non-JSON response as an invalid provider response.
      () => null,
    )) as GoogleRoutesResponse | null;
    if (!body) throw new RoutingProviderUnavailable("Google Maps returned an invalid response");

    // No routes means no road connects the two points.
    const route = body.routes?.[0];
    if (!route) return null;

    // Google leaves distanceMeters out when it is zero, and gives duration as e.g. "4174s".
    const seconds = Number.parseFloat(route.duration ?? "");
    if (!Number.isFinite(seconds) || seconds < 0) throw new RoutingProviderUnavailable("Google Maps returned an invalid duration");
    return { distanceMeters: route.distanceMeters ?? 0, durationSeconds: Math.round(seconds) };
  }
}
