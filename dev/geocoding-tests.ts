import assert from "node:assert/strict";
import { GeoapifyAdapter } from "../src/adapters/geocoding/geoapify";
import { GeocodingProviderUnavailable } from "../src/adapters/geocoding/geocoding-provider";

// Verifies Geoapify request construction, successful mapping and failure handling.
async function run() {
  let requestUrl: URL | undefined;
  const successful = new GeoapifyAdapter({
    apiKey: "test-key",
    // Returns one deterministic Geoapify result without using the network.
    request: async (input) => {
      requestUrl = new URL(input);
      return new Response(JSON.stringify({ results: [{ lat: 6.5973334, lon: 3.3542226 }] }), { status: 200 });
    },
  });

  const coordinates = await successful.geocodeAddress({
    address: "14 Allen Avenue, Ikeja, Lagos, NG",
    countryCode: "NG",
  });

  assert.deepEqual(coordinates, { latitude: 6.5973334, longitude: 3.3542226 });
  assert.equal(requestUrl?.searchParams.get("text"), "14 Allen Avenue, Ikeja, Lagos, NG");
  assert.equal(requestUrl?.searchParams.get("filter"), "countrycode:ng");
  assert.equal(requestUrl?.searchParams.get("apiKey"), "test-key");

  const empty = new GeoapifyAdapter({
    apiKey: "test-key",
    // Returns a valid response with no matching address.
    request: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
  });
  assert.equal(await empty.geocodeAddress({ address: "Unknown", countryCode: "NG" }), null);

  const unavailable = new GeoapifyAdapter({
    apiKey: "test-key",
    // Simulates a provider outage.
    request: async () => new Response(null, { status: 503 }),
  });
  await assert.rejects(
    unavailable.geocodeAddress({ address: "14 Allen Avenue", countryCode: "NG" }),
    GeocodingProviderUnavailable,
  );

  console.log("Geocoding tests passed");
}

run().catch(
  // Reports an assertion or adapter failure to the test process.
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
