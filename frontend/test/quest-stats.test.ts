import assert from "node:assert/strict";
import test from "node:test";
import { createStarApi } from "../src/lib/star-api";

const completed = (id: string, childId = "2") => ({
  id,
  child: { id: childId },
  status: "COMPLETED",
});

test("completed quest count follows every child-scoped history page and excludes pending, cancelled, and direct Star requests", async () => {
  const calls: number[] = [];
  const api = createStarApi(async (input) => {
    const url = new URL(String(input), "https://app.invalid");
    assert.equal(url.pathname, "/api/star/families/1/inbox");
    assert.equal(url.searchParams.get("childId"), "2");
    assert.equal(url.searchParams.get("view"), "history");
    assert.equal(url.searchParams.get("first"), "100");
    const skip = Number(url.searchParams.get("skip"));
    calls.push(skip);
    return Response.json({
      quests:
        skip === 0
          ? Array.from({ length: 100 }, (_, index) => ({
              ...completed(String(index)),
              status:
                index === 0
                  ? "CANCELLED"
                  : index === 1
                    ? "SUBMITTED"
                    : "COMPLETED",
            }))
          : [completed("2"), completed("100"), completed("other", "3")],
      requests: [{ id: "star-request", status: "APPROVED", quest: null }],
      nextOffset: skip === 0 ? 100 : null,
    });
  });
  assert.equal(await api.completedQuestCount("1", "2"), 99);
  assert.deepEqual(calls, [0, 100]);
});

test("empty quest history returns a genuine zero", async () => {
  const api = createStarApi(async () =>
    Response.json({ quests: [], nextOffset: null }),
  );
  assert.equal(await api.completedQuestCount("1", "2"), 0);
});

test("a failed later page does not return a misleading partial count", async () => {
  let calls = 0;
  const api = createStarApi(async () =>
    ++calls === 1
      ? Response.json({ quests: [completed("1")], nextOffset: 100 })
      : Response.json({ message: "Indexer unavailable" }, { status: 503 }),
  );
  await assert.rejects(api.completedQuestCount("1", "2"), { status: 503 });
});

test("malformed quest history and stalled cursors fail instead of becoming zero", async () => {
  for (const page of [
    { nextOffset: null },
    { quests: [{}], nextOffset: null },
    { quests: [{ ...completed("1"), status: "INVALID" }], nextOffset: null },
    { quests: [], nextOffset: 0 },
  ]) {
    const api = createStarApi(async () => Response.json(page));
    await assert.rejects(api.completedQuestCount("1", "2"), {
      code: "STAR_API_INVALID_RESPONSE",
    });
  }
});
