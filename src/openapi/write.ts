import { writeFileSync } from "node:fs";
import { openApiDocument } from "./document";

// npm run openapi [-- https://orderly.up.railway.app] writes openapi.json for Chord.
const url = process.argv[2] ?? process.env.PUBLIC_URL;
writeFileSync("openapi.json", JSON.stringify(openApiDocument(url), null, 2) + "\n");
console.log(`Wrote openapi.json${url ? ` for ${url}` : " (no server URL; pass one for Chord)"}`);
