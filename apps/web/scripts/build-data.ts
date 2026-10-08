// Runs the real engine over every scenario and Attack Lab combination, for the snapshot preview build.
import { writeFileSync } from "node:fs";
import { buildDataset } from "@ostira/core/dataset";

const t = performance.now();
const d = await buildDataset({ allCombinations: true });
writeFileSync(new URL("../preview/dataset.json", import.meta.url), JSON.stringify(d));
console.log(`${Object.keys(d.scenarios).length} evaluations, sweep ${d.sweep.blocked}/${d.sweep.total} blocked, ${Math.round(performance.now() - t)} ms`);
