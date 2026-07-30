import { loadWorkflows } from "./load.mjs";

export function checkWorkflow(doc) {
  const errors = [];
  const order = new Map();
  const loops = [];
  const gates = [];
  let idx = 0;
  const record = (name) => {
    if (order.has(name)) errors.push(`duplicate phase '${name}' — a workflow DAG must be acyclic`);
    else order.set(name, idx);
    idx++;
  };
  for (const p of doc?.phases ?? []) {
    if (typeof p === "string") record(p);
    else if (p && Array.isArray(p.parallel)) for (const n of p.parallel) record(n);
    else if (p && p.name) {
      record(p.name);
      if (p.loop?.return_to) loops.push({ phase: p.name, target: p.loop.return_to });
      if (p.gate?.after) gates.push({ phase: p.name, after: p.gate.after });
    }
  }
  for (const { phase, target } of loops) {
    if (!order.has(target)) errors.push(`loop phase '${phase}' return_to='${target}' is not a declared phase`);
    else if (order.get(target) >= order.get(phase)) errors.push(`loop phase '${phase}' return_to='${target}' must be an EARLIER phase`);
  }
  // A gate reads severity counts from phases that must ALREADY have reported. Pointing it at a
  // later or undeclared phase is not a runtime error — step 3-gate fails OPEN on an unparsable
  // source — so it would silently dispatch the gated phase on every run instead of never.
  for (const { phase, after } of gates) {
    for (const target of after) {
      if (!order.has(target)) errors.push(`gated phase '${phase}' gate.after='${target}' is not a declared phase`);
      else if (order.get(target) >= order.get(phase)) errors.push(`gated phase '${phase}' gate.after='${target}' must be an EARLIER phase`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function checkAllWorkflows(root = process.cwd()) {
  const { workflows, errors } = loadWorkflows(root);
  const results = workflows.map(({ file, doc }) => ({ file, ...checkWorkflow(doc) }));
  for (const e of errors) results.push({ file: e.file, ok: false, errors: [e.error] });
  return results;
}
