/**
 * The shape every bus_campus.bus_overrides document must have, as the
 * collection's `$jsonSchema` validator, so MongoDB refuses a bad write instead
 * of the server dropping the document at read time (busOverrideDoc in
 * src/bus/schedule/bus-schedule.schema.ts). A dropped override fails open: its
 * day falls through to the weekly pattern and serves the regular timetable on a
 * day the operator closed.
 *
 * Only a `replace` override needs `entries`; `noService` may leave them out.
 * __tests__/nest/bus/bus-overrides-validator.test.ts pins this schema, and the
 * check below, to busOverrideDoc over the same documents on a real mongod.
 *
 * Applied by scripts/apply-bus-overrides-validator.js. The seed scripts call
 * assertValidOverrides before they write, so a bad document stops the run with
 * every problem listed, before MongoDB is asked.
 */

const OBJECT_ITEMS = { bsonType: "array", items: { bsonType: "object" } };

const BUS_OVERRIDES_SCHEMA = {
  bsonType: "object",
  required: ["serviceId", "date", "type", "notices"],
  properties: {
    serviceId: { bsonType: "string" },
    date: { bsonType: "string" },
    type: { enum: ["replace", "noService"] },
    label: { bsonType: ["string", "null"] },
    notices: OBJECT_ITEMS,
    entries: OBJECT_ITEMS,
  },
  anyOf: [
    { properties: { type: { enum: ["replace"] } }, required: ["entries"] },
    { properties: { type: { enum: ["noService"] } } },
  ],
};

const BUS_OVERRIDES_VALIDATOR = { $jsonSchema: BUS_OVERRIDES_SCHEMA };

function bsonTypeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "double";
  return typeof value;
}

/**
 * The problems of `value` against `schema`, each prefixed with its path. Reads
 * only the keywords BUS_OVERRIDES_SCHEMA uses: bsonType, enum, required,
 * properties, items and anyOf.
 */
function violationsOf(value, schema, at) {
  const problems = [];
  if (schema.bsonType) {
    const allowed = [].concat(schema.bsonType);
    if (!allowed.includes(bsonTypeOf(value))) return [`${at}: must be ${allowed.join(" or ")}`];
  }
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  for (const field of schema.required ?? []) {
    if (!Object.hasOwn(value, field)) problems.push(`${at}${field}: required`);
  }
  for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
    if (Object.hasOwn(value, field)) problems.push(...violationsOf(value[field], fieldSchema, `${at}${field}`));
  }
  if (schema.items) value.forEach((item, index) => problems.push(...violationsOf(item, schema.items, `${at}[${index}]`)));
  if (schema.anyOf) {
    const branches = schema.anyOf.map((branch) => violationsOf(value, branch, at));
    if (branches.every((branch) => branch.length > 0)) problems.push(...branches[0]);
  }
  return problems;
}

function overrideViolations(doc) {
  return violationsOf(doc, BUS_OVERRIDES_SCHEMA, "").map((problem) => problem.replace(/^: /, ""));
}

function keyOf(doc, index) {
  const isObject = doc !== null && typeof doc === "object";
  return isObject && typeof doc.serviceId === "string" ? `${doc.serviceId}/${doc.date}` : `#${index}`;
}

/** Throws one error listing every document that bus_overrides would refuse, and why. */
function assertValidOverrides(docs) {
  const bad = docs.flatMap((doc, index) => {
    const problems = overrideViolations(doc);
    return problems.length === 0 ? [] : [`${keyOf(doc, index)}: ${problems.join("; ")}`];
  });
  if (bad.length > 0) throw new Error(`bus_overrides would refuse ${bad.length} document(s):\n  ${bad.join("\n  ")}`);
}

module.exports = { BUS_OVERRIDES_VALIDATOR, overrideViolations, assertValidOverrides };
