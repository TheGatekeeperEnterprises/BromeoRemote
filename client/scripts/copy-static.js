const { copyFileSync, mkdirSync, existsSync } = require("fs");
const { join } = require("path");

const root = join(__dirname, "..");
const pairs = [
  ["src/renderer/index.html", "dist/renderer/index.html"],
  ["src/renderer/mini.html", "dist/renderer/mini.html"],
  ["src/renderer/host-annotate.html", "dist/renderer/host-annotate.html"],
  ["src/renderer/styles.css", "dist/renderer/styles.css"],
];

for (const [from, to] of pairs) {
  const src = join(root, from);
  const dest = join(root, to);
  mkdirSync(join(dest, ".."), { recursive: true });
  if (existsSync(src)) copyFileSync(src, dest);
}

console.log("Static assets gekopieerd naar dist/.");
