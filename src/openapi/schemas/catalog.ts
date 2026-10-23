import { DAYS } from "../../utils/store-hours";
import { z } from "../registry";
import { Money, PriceInput } from "./money";

// Builds a trimmed text schema with the requested maximum length.
const Text = (max: number) => z.string().trim().min(2).max(max);
const CountryCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "use a two-letter country code, e.g. NG");
const Time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use 24-hour HH:MM, e.g. 09:00 or 19:30")
  .openapi({ example: "09:00" });

export const AddressInput = z
  .object({
    line1: Text(120).openapi({ example: "3 Herbert Macaulay Way" }),
    line2: Text(120).optional().openapi({ example: "Tejuosho House" }),
    area: Text(80).openapi({ example: "Yaba" }),
    city: Text(80).openapi({ example: "Lagos" }),
    state: Text(80).openapi({ example: "Lagos" }),
    country_code: CountryCode.default("NG").openapi({ example: "NG" }),
    postal_code: z.string().trim().min(3).max(20).optional().openapi({ example: "101233" }),
    directions_note: z.string().trim().min(3).max(200).optional()
      .openapi({ example: "Inside Centage Plaza, opposite the bus stop" }),
  })
  .openapi("StoreAddressInput");

export const AddressPatch = z
  .object({
    line1: AddressInput.shape.line1.optional(),
    line2: AddressInput.shape.line2.unwrap().nullable().optional(),
    area: AddressInput.shape.area.optional(),
    city: AddressInput.shape.city.optional(),
    state: AddressInput.shape.state.optional(),
    country_code: CountryCode.optional(),
    postal_code: AddressInput.shape.postal_code.unwrap().nullable().optional(),
    directions_note: AddressInput.shape.directions_note.unwrap().nullable().optional(),
  })
  // Requires at least one address property in a patch.
  .refine((address) => Object.values(address).some(
    // Detects whether a patch value was supplied.
    (value) => value !== undefined,
  ), {
    message: "send at least one address field",
  });

export const CoordinatesInput = z
  .object({
    latitude: z.number().min(-90).max(90).openapi({ example: 6.604718 }),
    longitude: z.number().min(-180).max(180).openapi({ example: 3.350299 }),
  })
  .openapi("StoreCoordinatesInput");

export const HoursInput = z
  .array(
    z.object({
      days: z.array(z.enum(DAYS)).min(1).openapi({ example: ["mon", "tue", "wed", "thu", "fri", "sat"] }),
      opens: Time,
      closes: Time.openapi({ example: "19:00" }),
    }),
  )
  .min(1)
  // Rejects schedules whose closing time is not after opening time.
  .refine((groups) => groups.every(
    // Validates one opening-hours group.
    (group) => group.closes > group.opens,
  ), {
    message: "closes must be later than opens on the same day",
  })
  // Rejects schedules that define the same weekday more than once.
  .refine((groups) => new Set(groups.flatMap(
    // Collects the weekdays from one hours group.
    (group) => group.days,
  )).size === groups.flatMap(
    // Collects weekdays again for the ungrouped length comparison.
    (group) => group.days,
  ).length, {
    message: "each day can appear only once",
  })
  .openapi({ description: "Open days and times, Lagos time. Days left out are closed." });

const OptionalText = z.string().nullable();
const AddressView = {
  address: z.string().openapi({ example: "14 Allen Avenue, Ikeja, Lagos" }),
  address_details: z.object({
    line1: z.string(),
    line2: OptionalText,
    area: z.string(),
    city: z.string(),
    state: z.string(),
    country_code: z.string(),
    postal_code: OptionalText,
    directions_note: OptionalText,
  }),
  location: z.object({
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    map_url: z.string().url().openapi({ description: "Text fallback when the channel cannot send a native location pin" }),
  }),
};

const HoursView = {
  opening_hours: z.string().openapi({ example: "Mon to Sat, 9am to 7pm; Sun, closed" }),
  hours: z.array(
    z.object({
      day: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])
        .openapi({ example: "Monday" }),
      opens: Time,
      closes: Time.openapi({ example: "19:00" }),
    }),
  ),
  open_now: z.boolean().openapi({ description: "Open right now, Lagos time" }),
};

export const Store = z
  .object({
    id: z.string().openapi({ example: "ikeja" }),
    name: z.string().openapi({ example: "Kola Gadgets Ikeja" }),
    ...AddressView,
    ...HoursView,
  })
  .openapi("Store");

const StoreStock = z.object({
  store_id: z.string(),
  store_name: z.string(),
  available: z.number().int().openapi({ description: "Units free to sell now (held units already taken off)" }),
});

export const Product = z
  .object({
    id: z.string().openapi({ example: "IP13-128" }),
    name: z.string().openapi({ example: "iPhone 13" }),
    variant: z.string().nullable().openapi({ example: "128GB" }),
    price: Money,
    min_price: Money.optional().openapi({
      description: "Lowest discounted price allowed. Owner only; never shown to customers.",
    }),
    stores: z.array(StoreStock),
    total_available: z.number().int(),
  })
  .openapi("Product");

const StoreId = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, numbers and dashes");

export const AddStoreBody = z.object({
  id: StoreId.optional().openapi({ description: "Short id, e.g. yaba. Made from the name if left out.", example: "yaba" }),
  name: z.string().trim().min(2).max(80).openapi({ example: "Kola Gadgets Yaba" }),
  address: AddressInput,
  location: CoordinatesInput.nullable().optional().openapi({
    description: "Exact map pin. Omit to geocode the address automatically, or send null to create the store without a pin.",
  }),
  hours: HoursInput,
});

export const StoreParams = z.object({ id: StoreId.openapi({ example: "lekki" }) });

export const UpdateStoreBody = z
  .object({
    name: AddStoreBody.shape.name.optional(),
    address: AddressPatch.optional(),
    location: CoordinatesInput.nullable().optional().openapi({ description: "New map pin, or null to remove the current pin." }),
    hours: HoursInput.optional().openapi({
      description: "New times for the days listed only. Other days keep their hours. Lagos time.",
    }),
    closed_days: z.array(z.enum(DAYS)).min(1).optional().openapi({
      description: "Days the store will now be closed on",
      example: ["sun"],
    }),
  })
  // Requires a store patch to contain at least one change.
  .refine((input) => Object.values(input).some(
    // Detects whether a store field was supplied.
    (value) => value !== undefined,
  ), {
    message: "send at least one of name, address, location, hours or closed_days",
  })
  // Prevents a weekday from being opened and closed in the same request.
  .refine((input) => !input.closed_days?.some(
    // Checks one explicitly closed weekday against the new hours.
    (day) => input.hours?.some(
      // Detects whether an hours group contains the closed weekday.
      (group) => group.days.includes(day),
    ),
  ), {
    message: "a day can't be in both hours and closed_days",
    path: ["closed_days"],
  });

export const ListProductsQuery = z.object({
  store_id: z.string().optional().openapi({ description: "Only show stock at this store" }),
  q: z.string().max(80).optional().openapi({
    description: "Search words, e.g. 'iphone 13'. Every word must match.",
    example: "iphone 13",
  }),
  product_id: z.string().optional(),
});

export const AddProductBody = z
  .object({
    id: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]*$/).max(40).optional()
      .openapi({ description: "Product code, e.g. IP16-256. Made from name and variant if left out." }),
    name: z.string().trim().min(2).max(80).openapi({ example: "iPhone 16" }),
    variant: z.string().trim().max(60).optional().openapi({ example: "256GB" }),
    price: PriceInput.openapi({ description: "In the store's currency, main unit (not subunits)", example: 1150000 }),
    min_price: PriceInput.optional().openapi({ description: "Discount floor, same currency. Defaults to the price (no discounts)." }),
    stock: z
      .array(z.object({ store_id: z.string(), quantity: z.number().int().min(0).max(10_000) }))
      .default([])
      .openapi({ description: "Starting units per store. Stores left out start at 0." }),
  })
  // Keeps a product's discount floor at or below its selling price.
  .refine((input) => input.min_price === undefined || input.min_price <= input.price, {
    message: "min_price can't be above price",
    path: ["min_price"],
  });

export const UpdateStockBody = z
  .object({
    store_id: z.string().openapi({ example: "lekki" }),
    change: z.number().int().min(-10_000).max(10_000).optional()
      .openapi({ description: "Add (positive) or remove (negative) units, e.g. 3 for 'add 3 more'", example: 3 }),
    set_to: z.number().int().min(0).max(10_000).optional()
      .openapi({ description: "Units physically on hand after a count, including ones held for unpaid orders" }),
  })
  // Requires exactly one stock adjustment mode.
  .refine((input) => (input.change === undefined) !== (input.set_to === undefined), {
    message: "send exactly one of change or set_to",
  });

export const UpdatePriceBody = z.object({
  price: PriceInput.openapi({ description: "In the product's currency, main unit (not subunits)", example: 630000 }),
  min_price: PriceInput.optional().openapi({ description: "New discount floor, same currency. Lowered to the price if it would be above it." }),
});

export const ProductParams = z.object({ id: z.string().openapi({ example: "IP13-128" }) });
