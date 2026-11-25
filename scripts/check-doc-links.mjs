#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);
const markdownFiles = [];

function collectMarkdown(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const absolute = join(directory, entry);
    const stats = statSync(absolute);

    if (stats.isDirectory()) {
      collectMarkdown(absolute);
    } else if (stats.isFile() && extname(entry).toLowerCase() === ".md") {
      markdownFiles.push(absolute);
    }
  }
}

function removeCodeFences(markdown) {
  return markdown.replace(/^\s*(?:`{3,}|~{3,}).*?^\s*(?:`{3,}|~{3,})\s*$/gms, "");
}

function extractTargets(markdown) {
  const cleaned = removeCodeFences(markdown);
  const targets = [];
  const linkPattern = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
  let match;

  while ((match = linkPattern.exec(cleaned)) !== null) {
    const target = (match[1] ?? match[2] ?? "").trim();
    if (target) targets.push(target);
  }

  return targets;
}

function resolveMarkdownTarget(sourceFile, target) {
  if (
    target.startsWith("#") ||
    target.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  ) {
    return undefined; // External URLs and in-page anchors are checked by their own systems.
  }

  const pathname = decodeURIComponent(target.split(/[?#]/, 1)[0] ?? "");
  if (!pathname) return undefined;

  const destination = resolve(dirname(sourceFile), pathname);
  const relative = destination === root ? "" : destination.slice(root.length + 1);
  if (destination !== root && (relative.startsWith("..") || destination !== root && !destination.startsWith(root + sep))) {
    return { invalid: true, destination };
  }

  if (existsSync(destination)) {
    const stats = statSync(destination);
    if (stats.isDirectory()) {
      const candidates = [join(destination, "index.md"), join(destination, "README.md")];
      if (candidates.some(existsSync)) return undefined;
      return { invalid: false, destination };
    }
    return undefined;
  }

  return { invalid: false, destination };
}

collectMarkdown(root);
const failures = [];

for (const file of markdownFiles) {
  const source = (await import("node:fs/promises")).readFile;
  const contents = await source(file, "utf8");

  for (const target of extractTargets(contents)) {
    const resolved = resolveMarkdownTarget(file, target);
    if (resolved) {
      failures.push({
        source: file.slice(root.length + 1),
        target,
        reason: resolved.invalid ? "link escapes repository root" : "target does not exist"
      });
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[broken-link] ${failure.source} -> ${failure.target} (${failure.reason})`);
  }
  console.error(`Found ${failures.length} broken relative Markdown link(s).`);
  process.exitCode = 1;
} else {
  console.log(`Validated relative Markdown links across ${markdownFiles.length} files.`);
}
