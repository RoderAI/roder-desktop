#!/usr/bin/env node
import { createRdxPackage } from "./index.js";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(args.length === 0 ? 1 : 0);
}

const packageRoot = args[0];
const outIndex = args.findIndex((arg) => arg === "--out" || arg === "-o");
const outFile = outIndex === -1 ? undefined : args[outIndex + 1];

if (!packageRoot || (outIndex !== -1 && !outFile)) {
  printHelp();
  process.exit(1);
}

try {
  const result = await createRdxPackage({ packageRoot, outFile });
  process.stdout.write(`Created ${result.archivePath}\n`);
  for (const file of result.files) {
    process.stdout.write(`- ${file}\n`);
  }
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}

function printHelp(): void {
  process.stdout.write(`Usage: roder-extension-package <extension-folder> [--out extension.rdx]\n`);
}
