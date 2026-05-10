import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ExportTarget = {
  types?: string;
  default?: string;
};

type PackageJson = {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  license?: string;
  repository?: unknown;
  type?: string;
  main?: string;
  types?: string;
  exports: Record<string, ExportTarget>;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
};

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function preparePackageDist(packageRoot: string) {
  const distDir = path.join(packageRoot, "dist");
  const pkg = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as PackageJson;

  await mkdir(distDir, { recursive: true });

  const publishManifest = omitUndefined({
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    keywords: pkg.keywords,
    license: pkg.license,
    repository: pkg.repository,
    type: pkg.type,
    main: toDistRuntimePath(pkg.main),
    types: toDistTypesPath(pkg.types),
    exports: Object.fromEntries(
      Object.entries(pkg.exports).map(([subpath, target]) => [
        subpath,
        omitUndefined({
          types: toDistTypesPath(target.types),
          default: toDistRuntimePath(target.default),
        }),
      ]),
    ),
    bin: pkg.bin
      ? Object.fromEntries(
          Object.entries(pkg.bin).map(([name, target]) => [name, toDistRuntimePath(target)]),
        )
      : undefined,
    dependencies: rewriteWorkspaceDependencies(pkg.dependencies, pkg.version),
  });

  await writeFile(
    path.join(distDir, "package.json"),
    `${JSON.stringify(publishManifest, null, 2)}\n`,
    "utf8",
  );

  await copyFirstExisting(distDir, [
    path.join(packageRoot, "README.md"),
    path.join(repoRoot, "README.md"),
  ]);
  await copyFirstExisting(distDir, [
    path.join(packageRoot, "LICENSE"),
    path.join(packageRoot, "LICENSE.md"),
    path.join(repoRoot, "LICENSE"),
    path.join(repoRoot, "LICENSE.md"),
  ]);
}

function toDistRuntimePath(filePath: string | undefined) {
  if (!filePath) return undefined;
  return toDistPath(filePath).replace(/\.(?:[cm]?ts|tsx)$/, ".js");
}

function toDistTypesPath(filePath: string | undefined) {
  if (!filePath) return undefined;
  return toDistPath(filePath).replace(/\.(?:[cm]?ts|tsx)$/, ".d.ts");
}

function toDistPath(filePath: string) {
  const normalized = filePath.startsWith("./") ? filePath.slice(2) : filePath;
  if (normalized.startsWith("src/")) return `./${normalized.slice(4)}`;
  if (normalized.startsWith("dist/")) return `./${normalized.slice(5)}`;
  return `./${normalized}`;
}

function rewriteWorkspaceDependencies(
  dependencies: Record<string, string> | undefined,
  packageVersion: string,
) {
  if (!dependencies) return undefined;

  return Object.fromEntries(
    Object.entries(dependencies).map(([name, version]) => [
      name,
      version === "workspace:*" ? packageVersion : version,
    ]),
  );
}

function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

async function copyFirstExisting(distDir: string, candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await cp(candidate, path.join(distDir, path.basename(candidate)));
      return;
    } catch {}
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await preparePackageDist(process.cwd());
}
