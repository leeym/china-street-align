#!/usr/bin/env node
"use strict";

/**
 * Pack the Chrome extension (manifest + runtime files only) into
 * dist/china-street-align-<version>.zip for GitHub Releases / Load unpacked.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

if (pkg.version !== manifest.version) {
  console.error(
    `Version mismatch: package.json=${pkg.version} manifest.json=${manifest.version}`
  );
  process.exit(1);
}

const version = manifest.version;
const name = "china-street-align";
const dist = path.join(root, "dist");
const stageDir = path.join(dist, name);
const zipName = `${name}-${version}.zip`;
const zipPath = path.join(dist, zipName);
const latestZipPath = path.join(dist, `${name}.zip`);

const FILES = [
  "manifest.json",
  "aligner-lib.js",
  "aligner-lib.js",
  "content.js",
  "page-basemap.js",
  "content.css",
  "service-worker.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "LICENSE"
];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

for (const file of FILES) {
  const src = path.join(root, file);
  if (!fs.existsSync(src)) {
    console.error(`Missing required file: ${file}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(stageDir, file));
}

// zip from dist/ so the archive root is china-street-align/
execFileSync("zip", ["-r", "-q", zipPath, name], { cwd: dist });
fs.copyFileSync(zipPath, latestZipPath);

const listed = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
if (!listed.includes(`${name}/manifest.json`)) {
  console.error("Zip layout invalid: expected china-street-align/manifest.json at archive root");
  process.exit(1);
}

console.log(`Packed ${zipName} and ${name}.zip (${version})`);
console.log(`  ${zipPath}`);
console.log(`  ${latestZipPath}`);
console.log("Load unpacked → select the unzipped china-street-align/ folder.");
