import { createWorld, buildScenario, SHOWCASE } from "../src/fixtures";

const world = await createWorld();
for (const s of SHOWCASE) {
  const sc = await buildScenario(world, s.base, s.attacks);
  const r = await world.verifier.evaluate(sc.request);
  const label = sc.title + (sc.attacks.length ? `  [+ ${sc.attacks.join(", ")}]` : "");
  console.log(`\n${r.decision.padEnd(6)} ${label}`);
  for (const f of r.reasons) console.log(`   ${f.decision.padEnd(6)} ${f.code}: ${f.message}`);
  console.log(`   pipeline: ${r.pipeline.map((p) => `${p.stage} ${p.ms}ms`).join(" · ")}`);
}
