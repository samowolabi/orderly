import { createApp } from "./app";
import { config } from "./config";

const { PORT } = config();

createApp().listen(PORT, () => {
  console.log(`Orderly API listening on :${PORT}`);
});
