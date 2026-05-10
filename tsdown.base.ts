import { preparePackageDist } from "./scripts/prepare-package-dist.ts";

type PackageTsdownOptions = {
  packageRoot: string;
  entry: Record<string, string>;
  copy?: Array<{ from: string; flatten?: boolean }>;
};

export function createPackageTsdownConfig(options: PackageTsdownOptions) {
  return {
    clean: true,
    copy: options.copy,
    deps: {
      skipNodeModulesBundle: true,
    },
    dts: true,
    entry: options.entry,
    fixedExtension: false,
    format: "esm",
    onSuccess: async () => {
      await preparePackageDist(options.packageRoot);
    },
    outDir: "dist",
    platform: "node",
    target: "node22",
    unbundle: true,
  };
}
