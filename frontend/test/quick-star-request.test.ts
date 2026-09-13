import assert from "node:assert/strict";
import test from "node:test";
import { StarApiError, type IntentInputs } from "../src/lib/star-api";
import {
  quickStarAmounts,
  submitQuickStarRequest,
  type QuickStarAmount,
} from "../src/lib/quick-star-request";

const workflow = "0x0000000000000000000000000000000000000001";
function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

test("quick Add Stars submits a child request for the chosen amount, never a direct reward", async () => {
  for (const stars of quickStarAmounts) {
    const storage = memoryStorage();
    let calls = 0;
    await submitQuickStarRequest(
      { childId: "7", workflow, stars },
      async (action, body, role) => {
        calls++;
        assert.equal(action, "requestStars");
        assert.equal(role, "CHILD");
        assert.equal(body.childId, "7");
        assert.equal(body.stars, String(stars));
        assert.equal(body.text, `Please add ${stars} Stars to my account.`);
        assert.match(body.submissionId, /^0x[0-9a-f]{64}$/);
        assert.equal(storage.entries.size, 1);
      },
      storage,
    );
    assert.equal(calls, 1);
    assert.equal(storage.entries.size, 0);
  }
});

test("unknown outcomes retain the identifier and retry the same request safely", async () => {
  const storage = memoryStorage();
  const bodies: IntentInputs["requestStars"][] = [];
  const input = { childId: "7", workflow, stars: 20 } as const;
  await assert.rejects(
    submitQuickStarRequest(
      input,
      async (_action, body) => {
        bodies.push(body);
        throw new Error("Network interrupted");
      },
      storage,
    ),
    /Network interrupted/,
  );
  assert.equal(storage.entries.size, 1);
  await submitQuickStarRequest(
    input,
    async (_action, body) => {
      bodies.push(body);
    },
    storage,
  );
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(storage.entries.size, 0);
});

test("a confirmed consumed identifier is cleared without automatically sending another request", async () => {
  const storage = memoryStorage();
  let calls = 0;
  await assert.rejects(
    submitQuickStarRequest(
      { childId: "7", workflow, stars: 10 },
      async () => {
        calls++;
        throw new StarApiError("Already recorded", {
          code: "SUBMISSION_ALREADY_RECORDED",
        });
      },
      storage,
    ),
    { code: "SUBMISSION_ALREADY_RECORDED" },
  );
  assert.equal(calls, 1);
  assert.equal(storage.entries.size, 0);
});

test("pending submission identifiers stay scoped to each child's workflow", async () => {
  const storage = memoryStorage();
  const identifiers = new Set<string>();
  for (const childId of ["7", "8"]) {
    await assert.rejects(
      submitQuickStarRequest(
        { childId, workflow, stars: 50 },
        async (_action, body) => {
          identifiers.add(body.submissionId);
          throw new Error("Unknown outcome");
        },
        storage,
      ),
    );
  }
  assert.equal(identifiers.size, 2);
  assert.equal(storage.entries.size, 2);
});

test("invalid choices and unavailable retry storage stop before requesting a signature", async () => {
  let calls = 0;
  const execute = async () => {
    calls++;
  };
  await assert.rejects(
    submitQuickStarRequest(
      { childId: "7", workflow, stars: 0 as QuickStarAmount },
      execute,
      memoryStorage(),
    ),
    /Choose 10, 20, or 50/,
  );
  await assert.rejects(
    submitQuickStarRequest({ childId: "7", workflow, stars: 10 }, execute, {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("Storage unavailable");
      },
    }),
    /Storage unavailable/,
  );
  assert.equal(calls, 0);
});
