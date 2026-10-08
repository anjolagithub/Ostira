// Turn the Vite single-file build into an artifact page: title, style, root, script. No document skeleton.
import { readFileSync, writeFileSync } from "node:fs";
const html = readFileSync(new URL("../dist-preview/index.html", import.meta.url), "utf8");
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]).join("\n");
const scripts = [...html.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]).join("\n");
const out = `<meta charset="utf-8">\n${title}\n${styles}\n<div id="root"></div>\n${scripts}\n`;
writeFileSync(new URL("../dist-preview/ostira-console.html", import.meta.url), out);
console.log("artifact bytes", out.length, "fonts inlined:", (out.match(/data:font\/woff2/g) || []).length);
