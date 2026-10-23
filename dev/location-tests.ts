import assert from "node:assert/strict";
import { AddressInput, AddressPatch } from "../src/openapi/schemas/catalog";
import { addressSearchText, addressView } from "../src/utils/store-location";

assert.equal(
  addressSearchText({
    line1: "14 Allen Avenue",
    area: "Ikeja",
    city: "Lagos",
    state: "Lagos",
    country_code: "NG",
  }),
  "14 Allen Avenue, Ikeja, Lagos, NG",
);

const ikeja = addressView({
  address_line1: "14 Allen Avenue",
  address_line2: null,
  area: "Ikeja",
  city: "Lagos",
  state: "Lagos",
  country_code: "NG",
  postal_code: null,
  latitude: 6.604718,
  longitude: 3.350299,
  directions_note: null,
});

assert.equal(ikeja.address, "14 Allen Avenue, Ikeja, Lagos");
assert.equal(ikeja.location.map_url.includes("6.604718%2C3.350299"), true);

const noPin = addressView({
  address_line1: "3 Herbert Macaulay Way",
  address_line2: null,
  area: "Yaba",
  city: "Lagos",
  state: "Lagos",
  country_code: "NG",
  postal_code: null,
  latitude: null,
  longitude: null,
  directions_note: "Opposite the bus stop",
});

assert.equal(noPin.location.latitude, null);
assert.equal(noPin.location.map_url.includes("3%20Herbert%20Macaulay%20Way%2C%20Yaba%2C%20Lagos"), true);
assert.equal(AddressInput.safeParse({ line1: "1 Road", area: "Yaba", city: "Lagos", state: "Lagos" }).success, true);
assert.equal(AddressPatch.safeParse({ line2: null }).success, true);
assert.equal(AddressPatch.safeParse({}).success, false);

console.log("Store location tests passed");
