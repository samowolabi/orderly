// Local stand-in for the two Paystack endpoints Orderly calls, so failure
// cases can be tested with curl without spending real test transactions.
// Run: npm run fake-paystack, then start the API with
//   PAYSTACK_BASE_URL=http://localhost:4010
//
// Drive it with:
//   POST /_fake/pay/:reference  { "outcome": "success" | "failed" | "ongoing", "amount"?: kobo }
//   POST /_fake/mode            { "initialize"?: "ok" | "fail", "verify"?: "ok" | "down" }
//   GET  /_fake/state
import express from "express";

type Tx = {
  reference: string;
  amount: number;
  currency: string;
  email: string;
  status: string;
  channel: string | null;
  paid_at: string | null;
  gateway_response: string | null;
};

const PORT = Number(process.env.FAKE_PAYSTACK_PORT ?? 4010);
const txs = new Map<string, Tx>();
const mode = { initialize: "ok", verify: "ok" };
const app = express();
app.use(express.json());

// Enforces a test-key-shaped authorization header on Paystack-like routes.
app.use("/transaction", (req, res, next) => {
  if (!req.get("authorization")?.startsWith("Bearer sk_test_")) {
    return res.status(401).json({ status: false, message: "Invalid key" });
  }
  next();
});

// Creates an in-memory fake transaction and checkout URL.
app.post("/transaction/initialize", (req, res) => {
  if (mode.initialize === "fail") return res.status(503).json({ status: false, message: "Service unavailable" });
  const { reference, amount, email, currency = "NGN" } = req.body ?? {};
  if (!reference || !Number.isInteger(amount) || !email) {
    return res.status(400).json({ status: false, message: "reference, amount and email are required" });
  }
  if (txs.has(reference)) return res.status(400).json({ status: false, message: "Duplicate Transaction Reference" });
  txs.set(reference, { reference, amount, currency, email, status: "abandoned", channel: null, paid_at: null, gateway_response: null });
  res.json({
    status: true,
    message: "Authorization URL created",
    data: { authorization_url: `http://localhost:${PORT}/pay/${reference}`, access_code: `fake_${reference}`, reference },
  });
});

// Returns the current state of a fake transaction reference.
app.get("/transaction/verify/:reference", (req, res) => {
  if (mode.verify === "down") return res.status(503).json({ status: false, message: "Service unavailable" });
  const tx = txs.get(req.params.reference);
  if (!tx) return res.status(400).json({ status: false, message: "Transaction reference not found" });
  res.json({ status: true, message: "Verification successful", data: { id: 1, ...tx } });
});

// Changes a fake transaction to a chosen payment outcome.
app.post("/_fake/pay/:reference", (req, res) => {
  const tx = txs.get(req.params.reference);
  if (!tx) return res.status(404).json({ error: "unknown reference" });
  const outcome = req.body?.outcome ?? "success";
  tx.status = outcome;
  tx.channel = outcome === "ongoing" ? null : "card";
  tx.gateway_response = outcome === "success" ? "Approved" : outcome === "failed" ? "Declined" : "Pending";
  tx.paid_at = outcome === "success" ? new Date().toISOString() : null;
  if (Number.isInteger(req.body?.amount)) tx.amount = req.body.amount;
  res.json(tx);
});

// Changes fake initialization and verification failure modes.
app.post("/_fake/mode", (req, res) => {
  Object.assign(mode, req.body ?? {});
  res.json(mode);
});

// Exposes fake Paystack state for local debugging.
app.get("/_fake/state", (_req, res) => res.json({ mode, transactions: [...txs.values()] }));

// Reports when the fake Paystack server is ready.
app.listen(PORT, () => console.log(`Fake Paystack on :${PORT}`));
