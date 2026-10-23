import { writeFileSync } from "node:fs";
import { openApiDocument } from "./document";

// Writes openapi.json, using the URL argument or PUBLIC_URL as the server address.
const url = process.argv[2] ?? process.env.PUBLIC_URL;
writeFileSync("openapi.json", JSON.stringify(openApiDocument(url), null, 2) + "\n");
console.log(`Wrote openapi.json${url ? ` for ${url}` : " (no server URL; pass one for Chord)"}`);
