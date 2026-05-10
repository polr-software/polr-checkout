import { definePolrMethod } from "../api/define-route";
import { handleWebhook } from "./webhook.service";

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/** Receives a provider notification at `${basePath}/webhook/:providerId`. */
export const receiveWebhook = definePolrMethod(
  {
    route: {
      disableBody: true,
      method: "POST",
      path: "/webhook/:providerId",
      requireHeaders: true,
      requireRequest: true,
      resolveInput: async (ctx) => {
        const headers = ctx.headers ?? new Headers();
        return {
          body: await ctx.request!.text(),
          headers: headersToRecord(headers),
        };
      },
    },
  },
  async (ctx) => handleWebhook(ctx.polr, ctx.input as { body: string; headers: Record<string, string> }),
);
