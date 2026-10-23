import { config } from "../config";
import { GeoapifyAdapter } from "./geocoding/geoapify";
import type { GeocodingProvider } from "./geocoding/geocoding-provider";
import { GoogleGeocodingAdapter } from "./geocoding/google";
import { PaystackAdapter } from "./payment/paystack";
import type { PaymentProcessor } from "./payment/payment-processor";

// Selects the active payment and geocoding providers.
export const paymentProcessor: PaymentProcessor = new PaystackAdapter();

let geocoder: GeocodingProvider | undefined;

// Returns the geocoder chosen by config, created on first use so config is read at run time.
export function geocodingProvider(): GeocodingProvider {
  geocoder ??= config().GEOCODING_PROVIDER === "google" ? new GoogleGeocodingAdapter() : new GeoapifyAdapter();
  return geocoder;
}
