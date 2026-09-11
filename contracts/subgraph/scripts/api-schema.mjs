import { buildASTSchema, Kind, parse, print, visit } from "graphql";
import pluralize from "pluralize";

// Offline API derivation for this project's object/enum entity schema.
// Graph Node's rules (not the storage schema alone) define query arguments:
// https://github.com/graphprotocol/graph-node/blob/master/graph/src/schema/api.rs
// In particular, singular lookups take ID!, while relationship filters take
// String even when the referenced entity has a Bytes or ID primary key.
// Unsupported schema features fail explicitly; use live introspection to
// validate against the actual deployed Graph Node as well.
export function buildApiSchema(source) {
  const document = parse(source);
  const objects = new Map();
  const enums = new Set();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.ENUM_TYPE_DEFINITION) {
      enums.add(definition.name.value);
    } else if (
      definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
      definition.directives.length === 1 &&
      definition.directives[0].name.value === "entity" &&
      definition.directives[0].arguments.every(
        (arg) => arg.name.value === "immutable",
      ) &&
      definition.interfaces.length === 0
    ) {
      objects.set(definition.name.value, definition);
    } else {
      throw new Error(
        `Unsupported API schema definition: ${definition.name?.value ?? definition.kind}`,
      );
    }
  }

  const scalarOps = (type) => {
    if (type === "Boolean" || enums.has(type))
      return ["", "not", "in", "not_in"];
    const ordered = ["", "not", "gt", "lt", "gte", "lte", "in", "not_in"];
    if (type === "String")
      return [
        ...ordered,
        "contains",
        "not_contains",
        "starts_with",
        "not_starts_with",
        "ends_with",
        "not_ends_with",
        "contains_nocase",
        "not_contains_nocase",
        "starts_with_nocase",
        "not_starts_with_nocase",
        "ends_with_nocase",
        "not_ends_with_nocase",
      ];
    if (type === "Bytes") return [...ordered, "contains", "not_contains"];
    if (["ID", "Int", "BigInt", "BigDecimal"].includes(type)) return ordered;
    throw new Error(`Unsupported API scalar: ${type}`);
  };
  const base = (type) =>
    type.kind === Kind.NAMED_TYPE ? type.name.value : base(type.type);
  const isList = (type) =>
    type.kind === Kind.LIST_TYPE ||
    (type.kind === Kind.NON_NULL_TYPE && isList(type.type));
  const collection = (name) =>
    `skip: Int = 0, first: Int = 100, orderBy: ${name}_orderBy, orderDirection: OrderDirection, where: ${name}_filter`;
  const rootArgs =
    "block: Block_height, subgraphError: _SubgraphErrorPolicy_ = deny";
  const generated = [];
  const roots = [];

  for (const [name, object] of objects) {
    const fields = [];
    const filters = [];
    const orderBy = [];
    for (const field of object.fields) {
      const fieldName = field.name.value;
      const fieldType = base(field.type);
      const child = objects.get(fieldType);
      const derived = field.directives.some(
        (d) => d.name.value === "derivedFrom",
      );
      if (
        field.arguments.length ||
        field.directives.some((d) => d.name.value !== "derivedFrom")
      ) {
        throw new Error(`Unsupported API field: ${name}.${fieldName}`);
      }
      fields.push(
        `${fieldName}${child && isList(field.type) ? `(${collection(fieldType)})` : ""}: ${print(field.type)}`,
      );
      orderBy.push(fieldName);
      if (child && !isList(field.type)) {
        for (const nested of child.fields) {
          if (!isList(nested.type) && !objects.has(base(nested.type))) {
            orderBy.push(`${fieldName}__${nested.name.value}`);
          }
        }
      }
      if (child) filters.push(`${fieldName}_: ${fieldType}_filter`);
      if (derived) continue;
      const scalar = child ? "String" : fieldType;
      let ops = scalarOps(scalar);
      if (isList(field.type)) {
        ops = ["", "not", "contains", "not_contains"];
        if (scalar === "String")
          ops.push("contains_nocase", "not_contains_nocase");
      }
      for (const op of ops) {
        const list = isList(field.type) || op === "in" || op === "not_in";
        filters.push(
          `${fieldName}${op ? `_${op}` : ""}: ${list ? `[${scalar}!]` : scalar}`,
        );
      }
    }
    generated.push(`type ${name} { ${fields.join("\n")} }`);
    generated.push(`enum ${name}_orderBy { ${orderBy.join(" ")} }`);
    generated.push(
      `input ${name}_filter { ${filters.join("\n")} and: [${name}_filter] or: [${name}_filter] _change_block: BlockChangedFilter }`,
    );
    const singular = name[0].toLowerCase() + name.slice(1);
    const plural = pluralize(singular);
    roots.push(`${singular}(id: ID!, ${rootArgs}): ${name}`);
    roots.push(
      `${plural === singular ? `${plural}_collection` : plural}(${collection(name)}, ${rootArgs}): [${name}!]!`,
    );
  }
  const enumDefinitions = document.definitions.filter(
    (d) => d.kind === Kind.ENUM_TYPE_DEFINITION,
  );
  const api = parse(`
    scalar Bytes
    scalar BigInt
    scalar BigDecimal
    enum OrderDirection { asc desc }
    enum _SubgraphErrorPolicy_ { allow deny }
    input Block_height { hash: Bytes number: Int number_gte: Int }
    input BlockChangedFilter { number_gte: Int! }
    type _Block_ { hash: Bytes number: Int! timestamp: Int }
    type _Meta_ { block: _Block_! deployment: String! hasIndexingErrors: Boolean! }
    ${generated.join("\n")}
    type Query { ${roots.join("\n")} _meta(block: Block_height): _Meta_ }
  `);
  return buildASTSchema({
    ...api,
    definitions: [
      ...api.definitions,
      ...enumDefinitions.map((d) => visit(d, { Directive: () => null })),
    ],
  });
}
