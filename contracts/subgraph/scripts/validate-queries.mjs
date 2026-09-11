import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildClientSchema,
  getIntrospectionQuery,
  parse,
  Source,
  validate,
} from "graphql";
import { buildApiSchema } from "./api-schema.mjs";

const root = resolve(import.meta.dirname, "..");
const queryDirectory = resolve(root, "queries");
const queryFiles = (await readdir(queryDirectory))
  .filter((name) => name.endsWith(".graphql"))
  .sort();

const documents = await Promise.all(
  queryFiles.map(async (name) =>
    parse(
      new Source(
        await readFile(resolve(queryDirectory, name), "utf8"),
        `queries/${name}`,
      ),
    ),
  ),
);

const backendGraphService = await readFile(
  resolve(root, "..", "..", "backend", "src", "services", "graph.ts"),
  "utf8",
);
const embeddedQueries = [
  ...backendGraphService.matchAll(/const\s+(\w+Query)\s*=\s*`([\s\S]*?)`;/g),
];
if (embeddedQueries.length === 0) {
  throw new Error("No backend GraphQL documents were found");
}
for (const match of embeddedQueries) {
  documents.push(parse(new Source(match[2], `backend/graph.ts:${match[1]}`)));
}

let schema = buildApiSchema(
  await readFile(resolve(root, "schema.graphql"), "utf8"),
);
const args = process.argv.slice(2);
if (args.length) {
  if (args.length !== 2 || args[0] !== "--endpoint") {
    throw new Error(
      "Usage: node scripts/validate-queries.mjs [--endpoint <subgraph-query-url>]",
    );
  }
  const response = await fetch(args[1], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Subgraph introspection failed (HTTP ${response.status})`);
  const body = await response.json();
  if (body.errors?.length || !body.data?.__schema)
    throw new Error("Subgraph introspection returned no valid schema");
  schema = buildClientSchema(body.data);
}
const errors = documents.flatMap((document) => validate(schema, document));
if (errors.length) {
  throw new Error(
    `GraphQL API validation failed:\n${errors.map((error) => error.toString()).join("\n\n")}`,
  );
}

console.log(
  `Schema-validated ${queryFiles.length} Subgraph query files and ${embeddedQueries.length} backend queries (${args.length ? "live API" : "offline Graph Node API model"})`,
);
