const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const ignoredDirs = new Set(["node_modules", ".git", "dist", "out"]);

function walkJsonFiles(dir, output) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }
      walkJsonFiles(fullPath, output);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      output.push(fullPath);
    }
  }
}

function main() {
  const files = [];
  walkJsonFiles(rootDir, files);

  let normalizedCount = 0;
  const errors = [];

  for (const filePath of files) {
    let raw;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      errors.push(`${path.relative(rootDir, filePath)}: read failed (${error.message})`);
      continue;
    }

    const cleaned = raw.replace(/^\uFEFF/, "");

    try {
      JSON.parse(cleaned);
    } catch (error) {
      errors.push(`${path.relative(rootDir, filePath)}: invalid JSON (${error.message})`);
      continue;
    }

    if (cleaned !== raw) {
      fs.writeFileSync(filePath, cleaned, "utf8");
      normalizedCount += 1;
      console.log(`Removed BOM: ${path.relative(rootDir, filePath)}`);
    }
  }

  console.log(`Checked ${files.length} JSON file(s).`);
  console.log(`Normalized ${normalizedCount} file(s).`);

  if (errors.length > 0) {
    console.error("JSON validation errors:");
    for (const line of errors) {
      console.error(`- ${line}`);
    }
    process.exit(1);
  }

  console.log("All JSON files are valid.");
}

main();
