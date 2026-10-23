import assert from "node:assert/strict";
import { retry } from "../src/utils/retry";

// An operation that fails a set number of times, then succeeds.
function flaky(failures: number) {
  let calls = 0;
  const run = async () => {
    calls++;
    if (calls <= failures) throw new Error(`fail ${calls}`);
    return `ok on ${calls}`;
  };
  return { run, calls: () => calls };
}

async function main() {
  // Succeeds on the third try.
  assert.equal(await retry(flaky(2).run, { delayMs: 1 }), "ok on 3");

  // Runs out of tries and throws the last error.
  const failing = flaky(5);
  await assert.rejects(retry(failing.run, { delayMs: 1 }), /fail 3/);
  assert.equal(failing.calls(), 3);

  // An error that isn't retryable is thrown at once.
  const refused = flaky(5);
  await assert.rejects(retry(refused.run, { delayMs: 1, retryOn: () => false }), /fail 1/);
  assert.equal(refused.calls(), 1);

  console.log("Retry tests passed");
}

main();
