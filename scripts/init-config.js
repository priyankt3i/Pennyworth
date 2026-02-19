const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "config", "providers.example.json");
const dst = path.join(root, "config", "providers.json");

if (fs.existsSync(dst)) {
  console.log("config/providers.json already exists. Skipped.");
  process.exit(0);
}

fs.copyFileSync(src, dst);
console.log("Created config/providers.json from example template.");
