// Local stand-in for the two Google Maps endpoints Orderly calls (Geocoding and
// Routes), so delivery quotes can be tested with curl without paid map calls.
//
// Geocoding knows a few Lagos areas by name and returns ZERO_RESULTS for anything
// containing "nowhere". Routes drives 1.3 times the straight-line distance at
// 25 km/h, and returns no route when the destination is on "Atlantis".
//
// Control endpoints:
//   POST /_fake/mode   { "geocode"?: "ok" | "down", "routes"?: "ok" | "down" }
import express from "express";

const PORT = Number(process.env.FAKE_GOOGLE_PORT ?? 4020);

const PLACES: [RegExp, number, number][] = [
  [/atlantis/i, 0, 0],
  [/lekki/i, 6.4474, 3.472],
  [/yaba/i, 6.5095, 3.3711],
  [/ikeja/i, 6.6018, 3.3515],
  [/victoria island/i, 6.4281, 3.4219],
  [/abuja/i, 9.0765, 7.3986],
];

let mode = { geocode: "ok", routes: "ok" };

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
  if (mode.geocode === "down") return res.status(503).send("down");
  const address = String(req.query.address ?? "");
  if (/nowhere/i.test(address)) return res.json({ status: "ZERO_RESULTS", results: [] });
  const [, lat, lng] = PLACES.find(([pattern]) => pattern.test(address)) ?? [null, 6.5244, 3.3792];
  res.json({ status: "OK", results: [{ geometry: { location: { lat, lng }, location_type: "ROOFTOP" } }] });
});

// Answers a driving route request with a predictable distance and time.
app.post("/routes", (req, res) => {
  if (mode.routes === "down") return res.status(503).send("down");
  const origin = req.body?.origin?.location?.latLng;
  const destination = req.body?.destination?.location?.latLng;
  if (!origin || !destination) return res.status(400).json({ error: "origin and destination latLng are required" });
  // Atlantis (0, 0) has no road to it.
  if (destination.latitude === 0 && destination.longitude === 0) return res.json({});
  const meters = Math.round(haversine(origin, destination) * 1.3);
  res.json({ routes: [{ distanceMeters: meters, duration: `${Math.round(meters / (25_000 / 3600))}s` }] });
});

// Switches the fake endpoints between working and failing.
app.post("/_fake/mode", (req, res) => {
  mode = { ...mode, ...(req.body ?? {}) };
  res.json(mode);
});

// Reports when the fake Google server is ready.
app.listen(PORT, () => console.log(`Fake Google Maps on :${PORT}`));
