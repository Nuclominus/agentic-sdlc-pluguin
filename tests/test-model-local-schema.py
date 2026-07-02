#!/usr/bin/env python3
"""Contract test for schemas/model-local.schema.json (no external deps)."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(HERE, "..", "schemas", "model-local.schema.json")

def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)

with open(SCHEMA_PATH) as f:
    schema = json.load(f)  # raises if the schema is not valid JSON

# Structural guarantees the design requires.
if schema.get("additionalProperties") is not False:
    fail("top-level additionalProperties must be false")
if "required" in schema and schema["required"]:
    fail("schema must not mark any key required")

tiers = schema["properties"]["default"]["enum"]
if sorted(tiers) != ["fable", "haiku", "opus", "sonnet"]:
    fail(f"default.enum must be the four pipeline tiers, got {tiers}")
agent_val = schema["properties"]["agents"]["additionalProperties"]["enum"]
if sorted(agent_val) != ["fable", "haiku", "opus", "sonnet"]:
    fail(f"agents value enum must be the four pipeline tiers, got {agent_val}")

def conforms(doc):
    """Minimal validation covering the constraints that matter for this file."""
    if not isinstance(doc, dict):
        return False
    for k in doc:
        if k not in ("$schema", "description", "default", "agents"):
            return False  # additionalProperties: false
    if "default" in doc and doc["default"] not in tiers:
        return False
    if "agents" in doc:
        if not isinstance(doc["agents"], dict):
            return False
        for v in doc["agents"].values():
            if v not in tiers:
                return False
    return True

good = {"$schema": "x", "default": "haiku", "agents": {"developer": "opus"}}
if not conforms(good):
    fail("valid example rejected")

bad_tier = {"default": "turbo"}
if conforms(bad_tier):
    fail("out-of-enum tier accepted")

bad_key = {"models": {"developer": "opus"}}
if conforms(bad_key):
    fail("unknown top-level key accepted")

if not conforms({}):
    fail("empty object should be valid")

print("PASS: model-local schema contract")
