import { config } from "../config";
import type { GeocodingProvider } from "./geocoding/geocoding-provider";
import { GoogleGeocodingAdapter } from "./geocoding/google";
import type { Notifier } from "./notify/notifier";
import { NoNotifier, ResendNotifier } from "./notify/resend";
import { PaystackAdapter } from "./payment/paystack";
import type { PaymentProcessor } from "./payment/payment-processor";
import { GoogleRoutesAdapter } from "./routing/google";
import type { RoutingProvider } from "./routing/routing-provider";

// Selects the active payment, geocoding and routing providers.
export const paymentProcessor: PaymentProcessor = new PaystackAdapter();

let geocoder: GeocodingProvider | undefined;

// Returns the geocoder, created on first use so config is read at run time.
export function geocodingProvider(): GeocodingProvider {
  geocoder ??= new GoogleGeocodingAdapter();
  return geocoder;
}

let router: RoutingProvider | undefined;

// Returns the driving-route provider for delivery quotes.
export function routingProvider(): RoutingProvider {
  router ??= new GoogleRoutesAdapter();
  return router;
}

let ownerNotifier: Notifier | undefined;

// Returns the owner email sender, or one that does nothing when Resend isn't set up.
export function notifier(): Notifier {
  const { RESEND_API_KEY, OWNER_EMAIL } = config();
  ownerNotifier ??= RESEND_API_KEY && OWNER_EMAIL ? new ResendNotifier() : new NoNotifier();
  return ownerNotifier;
}
