# Workaround for Next.js Static Export RSC Bug

- **Was fixed in [v16.2.0-canary.28](https://github.com/vercel/next.js/releases/v16.2.0-canary.28)**

Workaround for a Next.js static export bug where React Server Component (RSC) payload files are written under nested directories but requested at flat, dot-separated paths at runtime.

## The Problem

When using static export (`output: 'export'` in `next.config.js`), Next.js writes RSC payloads into nested folder structures like:

```
out/
  __next.some-route/
    __PAGE__.txt
```

However, the client-side runtime requests these payloads using a **flat, dot-separated** filename:

```
__next.some-route.__PAGE__.txt
```

Since the flat file doesn't exist, affected routes fail to load their RSC payloads.

### Related Issues

- [vercel/next.js#87682](https://github.com/vercel/next.js/issues/87682)
- [vercel/next.js#85374](https://github.com/vercel/next.js/issues/85374)

## What the Script Does

1. Recursively walks the static export output directory.
2. Finds all directories prefixed with `__next.` that contain a `__PAGE__.txt` payload file.
3. Copies each `__PAGE__.txt` to a flat alias path next to its parent folder, e.g. `__next.some-route/__PAGE__.txt` → `__next.some-route.__PAGE__.txt`.
4. Skips files that already exist and warns about missing payloads.

## Usage

Run the script as a post-build step after `next build` (with `output: 'export'` set in your `next.config.js`):

```bash
node postbuild-fix-next-rsc-aliases.mjs           # defaults to ./out
node postbuild-fix-next-rsc-aliases.mjs dist      # custom output directory
```

### Integrating into your build

Add it to your `package.json` scripts:

```jsonc
{
  "scripts": {
    "build": "next build",
    "postbuild": "node postbuild-fix-next-rsc-aliases.mjs",
  },
}
```

> If your export output directory is not the default `out/`, pass the directory name as the first argument.

## Output

The script logs a summary when finished:

```
[postbuild-fix-next-rsc-aliases.mjs] Finished. Created 5, already existed 0, missing 0.
```

| Counter             | Meaning                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| **Created**         | Flat alias files successfully copied                                     |
| **Already existed** | Alias files that were already in place (skipped)                         |
| **Missing**         | `__PAGE__.txt` not found inside an `__next.*` directory (warns per file) |

## Requirements

- Node.js ≥ 18 (uses `node:fs` and `node:path` built-in modules)
- No external dependencies
