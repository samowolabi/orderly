import assert from "node:assert/strict";
import { backoffDelay, retry } from "../src/utils/retry";

// A clock that only moves when the code under test sleeps.
function fakeClock() {
  let time = 0;
  const waits: number[] = [];
  return {
    waits,
    now: () => time,
    sleep: async (ms: number) => {
      waits.push(ms);
      time += ms;
    },
  };
}

// An operation that fails a set number of times, then succeeds.
function flaky(failures: number) {
  let calls = 0;
  const run = async (attempt: number) => {
    calls++;
    if (calls <= failures) throw new Error(`fail ${attempt}`);
    return `ok on ${attempt}`;
  };
  return { run, calls: () => calls };
}

async function main() {
  // Delays double from the base and stop at the cap; jitter scales them by a random fraction.
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => backoffDelay(n, { baseDelayMs: 100, maxDelayMs: 500, jitter: false })), [100, 200, 400, 500, 500]);
  assert.equal(backoffDelay(3, { baseDelayMs: 100, random: () => 0.5 }), 200);

  // Succeeds on the third try, waiting 100 then 200.
  {
    const clock = fakeClock();
    const op = flaky(2);
    assert.equal(await retry(op.run, { attempts: 3, baseDelayMs: 100, jitter: false, ...clock }), "ok on 3");
    assert.deepEqual(clock.waits, [100, 200]);
  }

  // Runs out of tries and throws the last error.
  {
    const clock = fakeClock();
    const op = flaky(5);
    await assert.rejects(retry(op.run, { attempts: 3, baseDelayMs: 100, jitter: false, ...clock }), /fail 3/);
    assert.equal(op.calls(), 3);
  }

  // An error that isn't retryable is thrown at once.
  {
    const clock = fakeClock();
    const op = flaky(5);
    await assert.rejects(retry(op.run, { attempts: 5, baseDelayMs: 100, retryOn: () => false, ...clock }), /fail 1/);
    assert.equal(op.calls(), 1);
    assert.deepEqual(clock.waits, []);
  }

  // The budget stops retrying before a wait that would pass it: 100 + 200 fits in 350, 400 more doesn't.
  {
    const clock = fakeClock();
    const op = flaky(5);
    await assert.rejects(retry(op.run, { attempts: 10, baseDelayMs: 100, jitter: false, budgetMs: 350, ...clock }), /fail 3/);
    assert.deepEqual(clock.waits, [100, 200]);
  }

  // onRetry sees each failed try and the wait that follows it.
  {
    const clock = fakeClock();
    const seen: string[] = [];
    await retry(flaky(1).run, {
      attempts: 2,
      baseDelayMs: 50,
      jitter: false,
      onRetry: (error, attempt, delay) => seen.push(`${(error as Error).message}/${attempt}/${delay}`),
      ...clock,
    });
    assert.deepEqual(seen, ["fail 1/1/50"]);
  }

  await assert.rejects(retry(async () => 1, { attempts: 0, baseDelayMs: 1 }), RangeError);

  console.log("Retry tests passed");
}

main();
