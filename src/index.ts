import { createApp } from "./app";
import { config } from "./config";
import { pool } from "./db/pool";
import { expireStaleOrders } from "./services/stock";

const { PORT } = config();

createApp().listen(PORT, () => {
  console.log(`Orderly API listening on :${PORT}`);
});

// Holds are also expired on every read that depends on stock; this sweep
// returns stock even when nobody is calling the API.
setInterval(() => {
  expireStaleOrders(pool)
    .then((n) => n && console.log(`Expired ${n} unpaid order(s)`))
    .catch((err) => console.error("expiry sweep failed", err));
}, 60_000).unref();
