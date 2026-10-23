import { z } from "../registry";

// Every amount the API returns, in one shape, so agents never guess a currency.
export const Money = z
  .object({
    amount: z.number().openapi({ description: "In the currency's main unit, not subunits", example: 650000 }),
    currency: z.string().openapi({ description: "ISO 4217 code", example: "NGN" }),
    display: z.string().openapi({ description: "Ready to show the customer. Quote it as is.", example: "₦650,000" }),
  })
  .openapi("Money");

// Prices sent by the owner: a plain number in the main unit of the product's currency.
export const PriceInput = z.number().positive().max(100_000_000);
