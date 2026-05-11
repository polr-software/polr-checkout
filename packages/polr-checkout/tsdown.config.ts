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
      "database/index": "src/database/index.ts",
      "database/neon-http": "src/database/neon-http.ts",
      "database/node-postgres": "src/database/node-postgres.ts",
      "migrations/neon-http": "src/migrations/neon-http.ts",
      "migrations/node-postgres": "src/migrations/node-postgres.ts",
    },
  }),
);
