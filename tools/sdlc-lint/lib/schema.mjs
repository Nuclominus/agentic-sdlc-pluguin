import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "tinyglobby";
import YAML from "yaml";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SCHEMA_MAP = [
  { glob: "plugins/**/manifest.yaml",        schema: "schemas/manifest.schema.json",    parse: "yaml" },
  { glob: "plugins/**/workflows/*.yaml",     schema: "schemas/workflow.schema.json",    parse: "yaml" },
  { glob: "plugins/sdlc/config/models.json", schema: "schemas/models.schema.json",      parse: "json" },
  { glob: "**/.claude/model.local.json",     schema: "schemas/model-local.schema.json", parse: "json" },
  { glob: "plugins/**/.claude-plugin/plugin.json", schema: "schemas/plugin.schema.json", parse: "json" },
];

const fmtErr = (e) => `${e.instancePath || "/"} ${e.message}`;

export function checkSchemas(root = process.cwd()) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const results = [];
  for (const { glob, schema, parse } of SCHEMA_MAP) {
    let validate;
    try {
      validate = ajv.compile(JSON.parse(readFileSync(join(root, schema), "utf8")));
    } catch (e) {
      results.push({ file: schema, schema, ok: false, tool_error: true, errors: [`schema load: ${e.message}`] });
      continue;
    }
    const files = globSync(glob, { cwd: root, absolute: true, dot: true })
      .filter(f => !f.includes("/test-fixtures/"));
    for (const file of files) {
      let raw;
      try {
        raw = readFileSync(file, "utf8");
      } catch (e) {
        results.push({ file, schema, ok: false, errors: [`read: ${e.message}`] });
        continue;
      }
      let data;
      try {
        data = parse === "yaml" ? YAML.parse(raw) : JSON.parse(raw);
      } catch (e) {
        results.push({ file, schema, ok: false, errors: [`parse: ${e.message}`] });
        continue;
      }
      const ok = validate(data);
      results.push({ file, schema, ok, errors: ok ? [] : validate.errors.map(fmtErr) });
    }
  }
  return results;
}
