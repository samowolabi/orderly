import { config } from "../config";
import { GeoapifyAdapter } from "./geocoding/geoapify";
import type { GeocodingProvider } from "./geocoding/geocoding-provider";
import { GoogleGeocodingAdapter } from "./geocoding/google";
import { PaystackAdapter } from "./payment/paystack";
import type { PaymentProcessor } from "./payment/payment-processor";
import { GoogleRoutesAdapter } from "./routing/google";
import type { RoutingProvider } from "./routing/routing-provider";

// Selects the active payment, geocoding and routing providers.
export const paymentProcessor: PaymentProcessor = new PaystackAdapter();

let geocoder: GeocodingProvider | undefined;

// Returns the geocoder chosen by config, created on first use so config is read at run time.
export function geocodingProvider(): GeocodingProvider {
  geocoder ??= config().GEOCODING_PROVIDER === "google" ? new GoogleGeocodingAdapter() : new GeoapifyAdapter();
  return geocoder;
}

let router: RoutingProvider | null | undefined;

// Returns the driving-route provider for delivery quotes, or null when no Google key is set.
export function routingProvider(): RoutingProvider | null {
  if (router === undefined) router = config().GOOGLE_MAPS_API_KEY ? new GoogleRoutesAdapter() : null;
  return router;
}
