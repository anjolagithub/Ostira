#!/usr/bin/env node
// Rename the product everywhere it appears: node scripts/rename-brand.mjs NewName
// Updates the display name (apps/web/ui/brand.ts), the npm scope (@old/core -> @new/core) and the root package name.
// Then run `npm install` to relink the workspaces.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const name = process.argv[2];
if (!name || !/^[A-Za-z][A-Za-z0-9]{1,30}$/.test(name)) {
  console.error("Usage: node scripts/rename-brand.mjs NewName   (letters and digits only)");
  process.exit(1);
}
const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const oldScope = pkg.name;
const newScope = name.toLowerCase();

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  if (["node_modules", ".next", "dist-preview", ".git"].includes(f)) return [];
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|json|md|mjs)$/.test(f) && f !== "package-lock.json" ? [p] : [];
});

let changed = 0;
for (const file of walk(root)) {
  const s = readFileSync(file, "utf8");
  let out = s.replaceAll(`@${oldScope}/`, `@${newScope}/`);
  if (file.endsWith("package.json") && file === join(root, "package.json")) out = out.replace(`"name": "${oldScope}"`, `"name": "${newScope}"`);
  if (file.endsWith(join("ui", "brand.ts"))) out = out.replace(/name: "[^"]*"/, `name: "${name}"`);
  if (out !== s) { writeFileSync(file, out); changed++; }
}
console.log(`Renamed ${oldScope} -> ${name} in ${changed} files. Now run: npm install`);
