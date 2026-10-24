// Local stand-in for the two Google Maps endpoints Orderly calls (Geocoding and
// Routes), so delivery quotes can be tested with curl without paid map calls.
//
// Geocoding knows a few Lagos areas by name, answers Sangotedo as an area-level match, and
// returns ZERO_RESULTS for anything containing "nowhere". Routes drives 1.3 times the straight-line distance at
// 25 km/h, and returns no route when the destination is on "Atlantis".
//
// Control endpoints:
//   POST /_fake/mode   { "geocode"?: "ok" | "down", "routes"?: "ok" | "down",
//                        "fail_next"?: { "geocode"?: n, "routes"?: n },   (the next n calls get a 503)
//                        "routes_down_from"?: [[lat, lng], ...] }       (routes from these points get a 503)
import express from "express";

const PORT = Number(process.env.FAKE_GOOGLE_PORT ?? 4020);

// Sangotedo comes back as an APPROXIMATE (area-level) match, like real Google for an area name.
const AREAS: [RegExp, number, number, string][] = [[/sangotedo/i, 6.4706, 3.6378, "Sangotedo 106104, Lagos, Nigeria"]];

const PLACES: [RegExp, number, number][] = [
  [/atlantis/i, 0, 0],
  [/lekki/i, 6.4474, 3.472],
  [/yaba/i, 6.5095, 3.3711],
  [/ikeja/i, 6.6018, 3.3515],
  [/victoria island/i, 6.4281, 3.4219],
  [/abuja/i, 9.0765, 7.3986],
];

let mode = { geocode: "ok", routes: "ok" };
// Calls still to fail before the endpoint recovers, for testing retries.
const failNext = { geocode: 0, routes: 0 };
// Origins whose routes fail, for testing a quote that leaves one store out.
let downFrom: [number, number][] = [];

// Uses up one queued failure for an endpoint, if any are left.
function failingNow(endpoint: keyof typeof failNext) {
  if (failNext[endpoint] <= 0) return false;
  failNext[endpoint]--;
  return true;
}

const app = express();
app.use(express.json());

// Straight-line distance in metres between two points.
function haversine(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// Answers a geocoding lookup for a few known areas.
app.get("/geocode/json", (req, res) => {
  if (mode.geocode === "down" || failingNow("geocode")) return res.status(503).send("down");
  const address = String(req.query.address ?? "");
  if (/nowhere/i.test(address)) return res.json({ status: "ZERO_RESULTS", results: [] });
  const area = AREAS.find(([pattern]) => pattern.test(address));
  if (area) {
    return res.json({ status: "OK", results: [{ geometry: { location: { lat: area[1], lng: area[2] }, location_type: "APPROXIMATE" }, formatted_address: area[3] }] });
  }
  const [, lat, lng] = PLACES.find(([pattern]) => pattern.test(address)) ?? [null, 6.5244, 3.3792];
  res.json({ status: "OK", results: [{ geometry: { location: { lat, lng }, location_type: "ROOFTOP" } }] });
});

// Answers a driving route request with a predictable distance and time.
app.post("/routes", (req, res) => {
  const origin = req.body?.origin?.location?.latLng;
  const fromDownPoint = downFrom.some(([lat, lng]) => Math.abs(lat - origin?.latitude) < 0.001 && Math.abs(lng - origin?.longitude) < 0.001);
  if (mode.routes === "down" || fromDownPoint || failingNow("routes")) return res.status(503).send("down");
  const destination = req.body?.destination?.location?.latLng;
  if (!origin || !destination) return res.status(400).json({ error: "origin and destination latLng are required" });
  // Atlantis (0, 0) has no road to it.
  if (destination.latitude === 0 && destination.longitude === 0) return res.json({});
  const meters = Math.round(haversine(origin, destination) * 1.3);
  res.json({ routes: [{ distanceMeters: meters, duration: `${Math.round(meters / (25_000 / 3600))}s` }] });
});

// Switches the fake endpoints between working and failing.
app.post("/_fake/mode", (req, res) => {
  const { fail_next: next, routes_down_from: from, ...rest } = req.body ?? {};
  mode = { ...mode, ...rest };
  Object.assign(failNext, next ?? {});
  if (from) downFrom = from;
  res.json(mode);
});

// Reports when the fake Google server is ready.
app.listen(PORT, () => console.log(`Fake Google Maps on :${PORT}`));
