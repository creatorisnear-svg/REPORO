---
name: libsql esbuild externals
description: @libsql/client uses native platform binaries that must be excluded from esbuild bundling
---

## Rule
Always add `"@libsql/*"` and `"libsql"` to the esbuild `external` array in build.mjs when bundling any project that depends on `@libsql/client`.

**Why:** libsql ships platform-specific native binaries (e.g. @libsql/linux-x64-gnu). esbuild tries to bundle them as regular JS and produces an invalid output. At runtime Node.js cannot resolve the native module and throws `Cannot find module '@libsql/linux-x64-gnu'`.

**How to apply:** In `artifacts/api-server/build.mjs` (or any esbuild config), add to the external array:
```js
"@libsql/*",
"libsql",
```
These will then be resolved from node_modules at runtime.
