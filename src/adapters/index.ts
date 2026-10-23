import { GeoapifyAdapter } from "./geocoding/geoapify";
import type { GeocodingProvider } from "./geocoding/geocoding-provider";
import { PaystackAdapter } from "./payment/paystack";
import type { PaymentProcessor } from "./payment/payment-processor";

// This is the only composition point that selects the active external providers.
export const geocodingProvider: GeocodingProvider = new GeoapifyAdapter();
export const paymentProcessor: PaymentProcessor = new PaystackAdapter();
