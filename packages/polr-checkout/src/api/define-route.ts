import { createEndpoint, createMiddleware } from "better-call";
import type { EndpointContext } from "better-call";
import * as z from "zod";

import type { PolrContext } from "../core/context";

const polrMiddleware = createMiddleware(async () => {
  return {} as PolrContext;
});

export const createPolrEndpoint: ReturnType<
  typeof createEndpoint.create<{ use: [typeof polrMiddleware] }>
> = createEndpoint.create({
  use: [polrMiddleware],
});

type BetterCallOptions = Parameters<typeof createPolrEndpoint>[1];

export type PolrMethodContext<TInput, TParams = Record<string, string> | undefined> = {
  headers: Headers;
  input: TInput;
  params: TParams;
  polr: PolrContext;
  request: Request | undefined;
};

export type PolrMethod<TServerInput, TResult> = ((
  polr: PolrContext,
  input: TServerInput,
  request?: Request,
) => Promise<TResult>) & {
  endpoint?: { options: unknown; path: string } & Record<string, unknown>;
};

type PolrMethodRouteConfig = Omit<BetterCallOptions, "body" | "method"> & {
  method: NonNullable<BetterCallOptions["method"]>;
  path: string;
  resolveInput?: (ctx: BetterCallEndpointContext) => Promise<unknown> | unknown;
};

export interface PolrMethodConfig {
  input?: BetterCallOptions extends { body?: infer TBody } ? TBody : never;
  route?: PolrMethodRouteConfig;
}

type InferSchemaInput<TSchema> = TSchema extends { _output: infer TOutput } ? TOutput : never;

type InferMethodInput<TConfig extends PolrMethodConfig> = TConfig["input"] extends undefined
  ? TConfig["route"] extends { resolveInput: (...args: unknown[]) => infer TResolved }
    ? Awaited<TResolved>
    : undefined
  : InferSchemaInput<NonNullable<TConfig["input"]>>;

type BetterCallEndpointContext = EndpointContext<
  string,
  NonNullable<BetterCallOptions["method"]>,
  object | undefined,
  undefined,
  [],
  boolean,
  boolean,
  PolrContext
>;

export function definePolrMethod<const TConfig extends PolrMethodConfig, TResult>(
  config: TConfig,
  handler: (ctx: PolrMethodContext<InferMethodInput<TConfig>>) => Promise<TResult> | TResult,
): PolrMethod<InferMethodInput<TConfig>, TResult> {
  const call = async (
    polr: PolrContext,
    input: InferMethodInput<TConfig>,
    request?: Request,
  ): Promise<TResult> => {
    return handler({
      headers: request?.headers ?? new Headers(),
      input,
      params: undefined as never,
      polr,
      request,
    });
  };

  if (config.route) {
    const endpoint = createPolrEndpoint(
      config.route.path,
      {
        body: config.input as never,
        ...config.route,
        path: undefined,
        resolveInput: undefined,
      },
      async (ctx) => {
        const routeInput = config.route?.resolveInput
          ? await config.route.resolveInput(ctx as BetterCallEndpointContext)
          : ctx.body;

        return handler({
          headers: ctx.headers ?? new Headers(),
          input: routeInput as InferMethodInput<TConfig>,
          params: ctx.params as Record<string, string> | undefined,
          polr: ctx.context,
          request: ctx.request,
        });
      },
    );

    (call as PolrMethod<InferMethodInput<TConfig>, TResult>).endpoint = endpoint as unknown as {
      options: unknown;
      path: string;
    } & Record<string, unknown>;
  }

  return call as PolrMethod<InferMethodInput<TConfig>, TResult>;
}

export { z };
