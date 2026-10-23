import { createApp } from "./app";
import { config } from "./config";
import { pool } from "./db/pool";
import { expireStaleOrders } from "./services/stock";

const { PORT } = config();

// Reports when the HTTP server is ready to accept requests.
createApp().listen(PORT, () => {
  console.log(`Orderly API listening on :${PORT}`);
});

// Expires unpaid holds every minute, so stock returns even when no request triggers a sweep.
setInterval(() => {
  expireStaleOrders(pool)
    // Reports only sweeps that actually expired orders.
    .then((n) => n && console.log(`Expired ${n} unpaid order(s)`))
    // Keeps the server alive while exposing background sweep failures.
    .catch((err) => console.error("expiry sweep failed", err));
}, 60_000).unref();
