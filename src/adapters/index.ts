import { GeoapifyAdapter } from "./geoapify";
import type { GeocodingProvider } from "./geocoding-provider";
import { PaystackAdapter } from "./paystack";
import type { PaymentProcessor } from "./payment-processor";

// This is the only composition point that selects the active external providers.
export const geocodingProvider: GeocodingProvider = new GeoapifyAdapter();
export const paymentProcessor: PaymentProcessor = new PaystackAdapter();
