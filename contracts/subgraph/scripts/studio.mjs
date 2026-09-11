import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configure } from "./configure.mjs";

export function studioArguments(argv, environment) {
  const [action] = argv;
  if (argv.length !== 1 || !["auth", "deploy"].includes(action))
    throw new Error(
      "Run auth:studio or deploy:studio without arguments; set SUBGRAPH_DEPLOY_KEY and SUBGRAPH_SLUG in .env",
    );
  const key = environment.SUBGRAPH_DEPLOY_KEY?.trim();
  if (!key)
    throw new Error(
      "SUBGRAPH_DEPLOY_KEY is required in contracts/subgraph/.env",
    );
  if (!/^[0-9a-fA-F]{32}$/.test(key))
    throw new Error(
      "SUBGRAPH_DEPLOY_KEY must be the 32-character hex Studio deploy key",
    );
  if (action === "auth") return ["auth", key];

  const slug = environment.SUBGRAPH_SLUG?.trim();
  if (!slug)
    throw new Error("SUBGRAPH_SLUG is required in contracts/subgraph/.env");
  if (slug.length > 255 || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(slug))
    throw new Error(
      "SUBGRAPH_SLUG must be the Studio project slug, not its URL or display name",
    );
  return ["deploy", slug, "--network", "sepolia", "--deploy-key", key];
}

async function runGraph(args) {
  const { run } = await import("@graphprotocol/graph-cli");
  const cliRoot = fileURLToPath(
    new URL(".", import.meta.resolve("@graphprotocol/graph-cli/package.json")),
  );
  // Invoke the official CLI in-process: the deploy key is never a shell/process argument.
  await run(args, cliRoot);
}

export async function runStudio(
  argv,
  environment = process.env,
  { configureNetwork = configure, graph = runGraph } = {},
) {
  // Validate both credentials before changing configuration or starting the CLI.
  const args = studioArguments(argv, environment);
  if (args[0] === "deploy") await configureNetwork();
  await graph(args);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.chdir(fileURLToPath(new URL("..", import.meta.url)));
  try {
    await runStudio(process.argv.slice(2));
  } catch (error) {
    const key = process.env.SUBGRAPH_DEPLOY_KEY?.trim();
    const message =
      error instanceof Error ? error.message : "Studio command failed";
    console.error(key ? message.replaceAll(key, "[redacted]") : message);
    process.exitCode = 1;
  }
}
