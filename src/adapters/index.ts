import { PaystackAdapter } from "./paystack";
import type { PaymentProcessor } from "./payment-processor";

// This is the only composition point that selects the active payment provider.
export const paymentProcessor: PaymentProcessor = new PaystackAdapter();
