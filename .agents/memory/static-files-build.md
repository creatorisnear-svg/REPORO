---
name: Static files in esbuild build
description: Static HTML/CSS/JS files in src/public must be copied to dist/public in build.mjs
---

## Rule
When serving static files from an esbuild-bundled Express server, the public directory must be copied to dist during the build step.

**Why:** esbuild only processes TypeScript/JavaScript entry points. Static assets in `src/public/` are not automatically included in `dist/`. At runtime, `__dirname` points to `dist/`, so `path.join(__dirname, "public")` resolves to `dist/public/` which is empty unless explicitly copied.

**How to apply:** In build.mjs, after `rm(distDir)` and before `esbuild(...)`:
```js
import { cp } from "node:fs/promises";
const srcPublic = path.resolve(artifactDir, "src/public");
const distPublic = path.resolve(distDir, "public");
await cp(srcPublic, distPublic, { recursive: true }).catch(() => null);
```
