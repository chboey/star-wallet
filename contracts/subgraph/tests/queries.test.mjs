import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse, validate } from "graphql";
import { buildApiSchema } from "../scripts/api-schema.mjs";

const source = await readFile(
  new URL("../schema.graphql", import.meta.url),
  "utf8",
);
const schema = buildApiSchema(source);
const errors = (query) =>
  validate(schema, parse(query)).map((error) => error.message);

test("the real backend operations pass, and restoring either original bug fails", async () => {
  const backend = await readFile(
    new URL("../../../backend/src/services/graph.ts", import.meta.url),
    "utf8",
  );
  for (const [name, correct, broken] of [
    ["childQuery", "$wallet: ID!", "$wallet: Bytes!"],
    ["familyActivitiesQuery", "$familyId: String!", "$familyId: ID!"],
  ]) {
    const operation = backend.match(
      new RegExp("const " + name + " = `([\\s\\S]*?)`;"),
    )?.[1];
    assert.ok(operation?.includes(correct), name);
    assert.deepEqual(errors(operation), []);
    assert.ok(errors(operation.replace(correct, broken)).length > 0, name);
  }
});

test("Bytes entity IDs still use ID! for singular lookups", () => {
  assert.deepEqual(
    errors("query($wallet: ID!) { childWallet(id: $wallet) { child { id } } }"),
    [],
  );
  assert.match(
    errors(
      "query($wallet: Bytes!) { childWallet(id: $wallet) { child { id } } }",
    ).join(),
    /expecting type "ID!"/,
  );
});

test("relationship filters use String, independently of the entity's ID scalar", () => {
  assert.deepEqual(
    errors(
      "query($family: String!) { protocolActivities(where: { family: $family }) { id } }",
    ),
    [],
  );
  assert.match(
    errors(
      "query($family: ID!) { protocolActivities(where: { family: $family }) { id } }",
    ).join(),
    /expecting type "String"/,
  );
  assert.deepEqual(
    errors(
      "query($vault: String!) { families(where: { vault: $vault }) { id } }",
    ),
    [],
  );
});

test("Bytes scalar filters are not incorrectly changed to ID or String", () => {
  assert.deepEqual(
    errors(
      "query($parent: Bytes!) { families(where: { parent: $parent }) { id } }",
    ),
    [],
  );
  assert.match(
    errors(
      "query($parent: ID!) { families(where: { parent: $parent }) { id } }",
    ).join(),
    /expecting type "Bytes"/,
  );
});

test("validates fields, arguments, enums, required variables, and nested collections", () => {
  for (const query of [
    '{ family(id: "1") { nonexistent } }',
    '{ family(typo: "1") { id } }',
    "{ goals(where: { status: TYPO }) { id } }",
    "{ goals(orderBy: nonexistent) { id } }",
    "query($id: ID) { family(id: $id) { id } }",
    '{ family(id: "1") { children(where: { nonexistent: true }) { id } } }',
  ])
    assert.ok(errors(query).length > 0, query);
  assert.deepEqual(
    errors(
      '{ family(id: "1") { children(first: 10, where: { active: true }, orderBy: createdAt) { id } } _meta { block { number hash timestamp } hasIndexingErrors } }',
    ),
    [],
  );
});

test("API validation reflects changes to the entity schema", () => {
  const changed = buildApiSchema(
    source.replace("  starBalance: BigInt!\n", ""),
  );
  assert.match(
    validate(changed, parse('{ child(id: "1") { starBalance } }'))[0].message,
    /Cannot query field/,
  );
});

test("unsupported schema features cannot silently produce a passing check", () => {
  assert.throws(
    () => buildApiSchema("type Entry @entity(timeseries: true) { id: Int8! }"),
    /Unsupported/,
  );
});
