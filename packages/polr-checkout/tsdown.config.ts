import { fileURLToPath } from "node:url";

import { defineConfig } from "tsdown";

import { createPackageTsdownConfig } from "../../tsdown.base.ts";

export default defineConfig(
  createPackageTsdownConfig({
    packageRoot: fileURLToPath(new URL(".", import.meta.url)),
    copy: [
      {
        flatten: false,
        from: "src/database/migrations/**/*",
      },
    ],
    entry: {
      index: "src/index.ts",
      "handlers/next": "src/handlers/next.ts",
      "client/index": "src/client/index.ts",
      "database/schema": "src/database/schema.ts",
    },
  }),
);
