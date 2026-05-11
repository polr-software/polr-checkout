import { PolrError, POLR_ERROR_CODES } from "./errors";
import type { PolrOptions } from "../types/options";

export function assertValidPolrOptions(options: PolrOptions): void {
  if (!options.provider) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.PROVIDER_REQUIRED);
  }
  if (!options.database?.store) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.DATABASE_REQUIRED);
  }
  if (options.basePath && !options.basePath.startsWith("/")) {
    throw PolrError.from(
      "BAD_REQUEST",
      POLR_ERROR_CODES.BASEPATH_INVALID,
      `basePath must start with "/", received "${options.basePath}"`,
    );
  }
}
