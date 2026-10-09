#!/usr/bin/env node
/*
 * Network Atlas viewer build.
 *
 * The viewer ships as a single self-contained index.html (no CDN, no network
 * access, opens straight from file://). We keep the source split under src/ for
 * maintainability and inline it back into that one file here.
 *
 *   node build/build.mjs          # write index.html
 *   node build/build.mjs --check  # exit 1 if the committed index.html is stale
 *
 * Zero dependencies: Node's fs + path only.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const buildDir = dirname(fileURLToPath(import.meta.url));
const root = join(buildDir, "..");
const outFile = join(root, "index.html");

// Normalise to LF and drop the single trailing newline so joined chunks are
// byte-for-byte the original blocks.
const readChunk = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");

function bundle(dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) throw new Error(`missing source directory: ${dir}`);
  const files = readdirSync(abs).filter((f) => f.endsWith(dir.includes("styles") ? ".css" : ".js")).sort();
  if (!files.length) throw new Error(`no source files in ${dir}`);
  return { files, text: files.map((f) => readChunk(join(abs, f))).join("\n") };
}

function build() {
  const template = readChunk(join(root, "src", "index.html"));
  const css = bundle("src/styles");
  const js = bundle("src/js");

  if (!template.includes("<!-- @styles -->")) throw new Error("src/index.html is missing the <!-- @styles --> marker");
  if (!template.includes("<!-- @scripts -->")) throw new Error("src/index.html is missing the <!-- @scripts --> marker");

  return template
    .replace("<!-- @styles -->", () => `<style>\n${css.text}\n</style>`)
    .replace("<!-- @scripts -->", () => `<script>\n${js.text}\n</script>`)
    + "\n";
}

const result = build();

if (process.argv.includes("--check")) {
  const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
  if (current !== result) {
    console.error("index.html is out of date — run: node build/build.mjs");
    process.exit(1);
  }
  console.log("index.html is up to date.");
} else {
  writeFileSync(outFile, result);
  console.log(`wrote index.html (${Buffer.byteLength(result)} bytes)`);
}
