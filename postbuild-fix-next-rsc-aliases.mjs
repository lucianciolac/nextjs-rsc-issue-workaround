/**
 * @fileoverview postbuild-fix-next-rsc-aliases.mjs
 *
 * Workaround for a Next.js static export issue where React Server Component (RSC)
 * payloads are written under nested `__next.<route>/__PAGE__.txt` directories, but
 * the runtime may request a flat, dot-separated filename instead
 * (`__next.<route>.__PAGE__.txt`).
 *
 * This script scans the export output, finds `__next.*` payload folders, and
 * copies `__PAGE__.txt` to the expected flat alias path next to the folder.
 *
 * Related Issues:
 * - https://github.com/vercel/next.js/issues/87682
 * - https://github.com/vercel/next.js/issues/85374
 *
 * Usage:
 *   node postbuild-fix-next-rsc-aliases.mjs          # defaults to ./out
 *   node postbuild-fix-next-rsc-aliases.mjs dist     # custom output dir
 */

import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_BUILD_DIR = 'out';
const RSC_DIR_PREFIX = '__next.';
const RSC_PAYLOAD_FILENAME = '__PAGE__.txt';

function readConfigFromCli(argv) {
  const buildDirArg = argv[2] ?? DEFAULT_BUILD_DIR;
  return { buildDir: path.resolve(process.cwd(), buildDirArg) };
}

function createLogger(prefix) {
  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

function createCounts() {
  return { created: 0, exists: 0, missing: 0 };
}

function updateCounts(counts, status) {
  counts[status] += 1;
}

function isSystemError(error, code) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function ensureDirExists(dirPath) {
  try {
    await fs.access(dirPath);
    return true;
  } catch {
    return false;
  }
}

function isRscDirectoryEntry(entry) {
  return entry.isDirectory() && entry.name.startsWith(RSC_DIR_PREFIX);
}

async function safeReadDir(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isSystemError(error, 'ENOENT')) return null;
    throw error;
  }
}

async function* walkRscDirectories(rootDir) {
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    const entries = await safeReadDir(currentDir);
    if (!entries) continue;

    const rscFolderNames = entries.filter(isRscDirectoryEntry).map((e) => e.name);
    if (rscFolderNames.length > 0) yield { parentDir: currentDir, rscFolderNames };

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(RSC_DIR_PREFIX)) {
        stack.push(path.join(currentDir, entry.name));
      }
    }
  }
}

function getPayloadPaths(parentDir, rscFolder) {
  return {
    nestedPayloadPath: path.join(parentDir, rscFolder, RSC_PAYLOAD_FILENAME),
    flatAliasPath: path.join(parentDir, `${rscFolder}.${RSC_PAYLOAD_FILENAME}`),
  };
}

async function createFlatAlias(parentDir, rscFolder) {
  const { nestedPayloadPath, flatAliasPath } = getPayloadPaths(parentDir, rscFolder);

  try {
    await fs.copyFile(nestedPayloadPath, flatAliasPath, constants.COPYFILE_EXCL);
    return 'created';
  } catch (error) {
    if (isSystemError(error, 'EEXIST')) return 'exists';
    if (isSystemError(error, 'ENOENT')) return 'missing';
    throw error;
  }
}

async function aliasAllPayloadsInDir(parentDir, rscFolderNames) {
  return Promise.all(
    rscFolderNames.map(async (folder) => ({
      folder,
      status: await createFlatAlias(parentDir, folder),
    })),
  );
}

async function run({ buildDir }, logger) {
  const exists = await ensureDirExists(buildDir);
  if (!exists) {
    logger.warn(
      `Build directory "${path.basename(buildDir)}/" was not found. Run \`pnpm build\` first.`,
    );
    return { counts: createCounts(), hadMissing: false };
  }

  const counts = createCounts();

  for await (const { parentDir, rscFolderNames } of walkRscDirectories(buildDir)) {
    const results = await aliasAllPayloadsInDir(parentDir, rscFolderNames);

    for (const { folder, status } of results) {
      updateCounts(counts, status);

      if (status === 'missing') {
        const { nestedPayloadPath } = getPayloadPaths(parentDir, folder);
        logger.warn(`RSC payload file was not found: ${nestedPayloadPath}`);
      }
    }
  }

  const hadMissing = counts.missing > 0;
  if (hadMissing) {
    logger.warn(`${counts.missing} payload(s) were missing. Some affected routes may not work.`);
  }

  logger.info(
    `Finished. Created ${counts.created}, already existed ${counts.exists}, missing ${counts.missing}.`,
  );

  return { counts, hadMissing };
}

const LOG_PREFIX = '[postbuild-fix-next-rsc-aliases.mjs]';
const logger = createLogger(LOG_PREFIX);
const config = readConfigFromCli(process.argv);

run(config, logger).catch((error) => {
  logger.error('Unexpected error:', error);
  process.exitCode = 1;
});
