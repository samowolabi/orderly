import assert from "node:assert/strict";
import { GeoapifyAdapter } from "../src/adapters/geocoding/geoapify";
import { GeocodingProviderUnavailable } from "../src/adapters/geocoding/geocoding-provider";
import { GoogleGeocodingAdapter } from "../src/adapters/geocoding/google";

// Verifies both geocoders' request construction, successful mapping and failure handling.
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

  const lowConfidence = new GeoapifyAdapter({
    apiKey: "test-key",
    // Returns a match Geoapify itself isn't sure about.
    request: async () =>
      new Response(JSON.stringify({ results: [{ lat: 6.4475, lon: 3.4698, rank: { confidence: 0 } }] }), { status: 200 }),
  });
  assert.equal(await lowConfidence.geocodeAddress({ address: "8 Admiralty Way, Lekki", countryCode: "NG" }), null);

  // Builds a Google adapter that answers every request with the given body and status.
  const google = (body: unknown, status = 200, onRequest?: (url: URL) => void) =>
    new GoogleGeocodingAdapter({
      apiKey: "google-test-key",
      // Returns a canned Google Geocoding API response without using the network.
      request: async (input) => {
        onRequest?.(new URL(input));
        return new Response(JSON.stringify(body), { status });
      },
    });

  let googleUrl: URL | undefined;
  const rooftop = google(
    { status: "OK", results: [{ geometry: { location: { lat: 6.5068, lng: 3.3781 }, location_type: "ROOFTOP" } }] },
    200,
    // Captures the request so its parameters can be checked.
    (url) => { googleUrl = url; },
  );
  assert.deepEqual(
    await rooftop.geocodeAddress({ address: "3 Herbert Macaulay Way, Yaba, Lagos, NG", countryCode: "ng" }),
    { latitude: 6.5068, longitude: 3.3781 },
  );
  assert.equal(googleUrl?.origin + googleUrl!.pathname, "https://maps.googleapis.com/maps/api/geocode/json");
  assert.equal(googleUrl?.searchParams.get("address"), "3 Herbert Macaulay Way, Yaba, Lagos, NG");
  assert.equal(googleUrl?.searchParams.get("components"), "country:NG");
  assert.equal(googleUrl?.searchParams.get("key"), "google-test-key");

  const approximate = google({ status: "OK", results: [{ geometry: { location: { lat: 6.52, lng: 3.37 }, location_type: "APPROXIMATE" } }] });
  assert.equal(await approximate.geocodeAddress({ address: "Somewhere, Lagos", countryCode: "NG" }), null);

  assert.equal(await google({ status: "ZERO_RESULTS", results: [] }).geocodeAddress({ address: "Nowhere", countryCode: "NG" }), null);

  await assert.rejects(
    google({ status: "REQUEST_DENIED", error_message: "The provided API key is invalid." }).geocodeAddress({ address: "x", countryCode: "NG" }),
    GeocodingProviderUnavailable,
  );
  await assert.rejects(google({}, 503).geocodeAddress({ address: "x", countryCode: "NG" }), GeocodingProviderUnavailable);

  console.log("Geocoding tests passed");
}

run().catch(
  // Reports an assertion or adapter failure to the test process.
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
