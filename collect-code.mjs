// collect-code.mjs
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

function parseArgs(argv) {
  const args = {
    root: ".",
    out: "code_dump.txt",
    exts: new Set([
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".html",
      ".css",
      ".scss",
      ".sass",
      ".less",
      ".json",
      ".yml",
      ".yaml",
      ".xml",
      ".svg",
    ]),
    ignoreDirs: new Set([
      "node_modules",
      ".git",
      ".next",
      "dist",
      "build",
      "out",
      "coverage",
      ".turbo",
      ".vercel",
      ".expo",
      "ios",
      "android",
    ]),
    ignoreFiles: new Set([
      "package-lock.json",
      "serviceAccountKey.json",
    ]),
    includeDts: true,
    maxKB: 10240,
    clipboard: false,
  };

  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--clipboard") {
      args.clipboard = true;
      continue;
    }

    if (a === "--no-dts") {
      args.includeDts = false;
      continue;
    }

    if (a.startsWith("--maxkb=")) {
      const v = Number(a.split("=", 2)[1]);
      if (Number.isFinite(v) && v > 0) args.maxKB = v;
      continue;
    }

    if (a.startsWith("--ext=")) {
      const v = a.split("=", 2)[1];
      args.exts = new Set(
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => (s.startsWith(".") ? s.toLowerCase() : "." + s.toLowerCase()))
      );
      continue;
    }

    if (a.startsWith("--ignore=")) {
      const v = a.split("=", 2)[1];
      v.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((d) => args.ignoreDirs.add(d));
      continue;
    }

    if (a.startsWith("--ignore-file=")) {
      const v = a.split("=", 2)[1];
      v.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((f) => args.ignoreFiles.add(f));
      continue;
    }

    if (!a.startsWith("--")) positional.push(a);
  }

  if (positional[0]) args.root = positional[0];
  if (positional[1]) args.out = positional[1];

  return args;
}

function shouldIgnoreName(name) {
  return name.startsWith(".");
}

function shouldIgnoreDir(dirName, ignoreDirs) {
  return shouldIgnoreName(dirName) || ignoreDirs.has(dirName);
}

function shouldIgnoreFileName(fileName, ignoreFiles) {
  return shouldIgnoreName(fileName) || ignoreFiles.has(fileName);
}

function isWantedFile(filePath, exts, includeDts, ignoreFiles) {
  const base = path.basename(filePath);
  if (shouldIgnoreFileName(base, ignoreFiles)) return false;

  const lower = filePath.toLowerCase();

  if (!includeDts && lower.endsWith(".d.ts")) return false;

  for (const ext of exts) {
    if (lower.endsWith(ext)) return true;
  }

  return false;
}

async function walk(rootAbs, ignoreDirs, ignoreFiles) {
  const out = [];
  const stack = [rootAbs];

  while (stack.length) {
    const cur = stack.pop();
    let entries;

    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const abs = path.join(cur, ent.name);

      if (ent.isDirectory()) {
        if (shouldIgnoreDir(ent.name, ignoreDirs)) continue;
        stack.push(abs);
      } else if (ent.isFile()) {
        if (shouldIgnoreFileName(ent.name, ignoreFiles)) continue;
        out.push(abs);
      }
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  const rootAbs = path.resolve(process.cwd(), args.root);
  const outAbs = path.resolve(process.cwd(), args.out);
  const selfAbs = path.resolve(fileURLToPath(import.meta.url));

  const allFiles = await walk(rootAbs, args.ignoreDirs, args.ignoreFiles);
  const wanted = [];

  for (const f of allFiles) {
    if (path.resolve(f) === selfAbs) continue;
    if (path.resolve(f) === outAbs) continue;
    if (!isWantedFile(f, args.exts, args.includeDts, args.ignoreFiles)) continue;

    let st;
    try {
      st = await fs.stat(f);
    } catch {
      continue;
    }

    const kb = st.size / 1024;
    if (kb > args.maxKB) continue;

    wanted.push(f);
  }

  let dump = "";
  dump += `Collected ${wanted.length} file(s)\n`;
  dump += `Root: ${rootAbs}\n`;
  dump += `Extensions: ${[...args.exts].join(", ")}\n`;
  dump += `Include .d.ts: ${args.includeDts}\n`;
  dump += `Ignored dirs: ${[...args.ignoreDirs].join(", ")}\n`;
  dump += `Ignored files: ${[...args.ignoreFiles].join(", ")}\n`;
  dump += `Hidden files/folders ignored: true\n`;
  dump += `Self ignored: true\n`;
  dump += `Output file ignored: true\n`;
  dump += `Max file size: ${args.maxKB} KB\n`;
  dump += `Generated at: ${new Date().toISOString()}\n`;
  dump += `\n\n`;

  for (const absPath of wanted) {
    const rel = path.relative(rootAbs, absPath).replaceAll("\\", "/");

    let content = "";
    try {
      content = await fs.readFile(absPath, "utf8");
    } catch {
      continue;
    }

    dump += `\n/* =========================================
   FILE: ${rel}
   ========================================= */\n\n`;
    dump += content.trimEnd() + "\n";
  }

  await fs.writeFile(outAbs, dump, "utf8");
  console.log(`Wrote: ${outAbs}`);
  console.log(`Files: ${wanted.length}`);

  if (args.clipboard) {
    const { spawn } = await import("child_process");
    await new Promise((resolve, reject) => {
      const p = spawn("pbcopy");
      p.on("error", reject);
      p.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`pbcopy exit ${code}`))
      );
      p.stdin.write(dump);
      p.stdin.end();
    });
    console.log("Copied to clipboard via pbcopy");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});