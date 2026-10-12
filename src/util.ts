import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ZodRawShape, type ZodType, type ZodTypeAny, type ZodTypeDef, z } from "zod";

/** Wrap a JSON payload as MCP tool output. Payloads with a top-level `error` are flagged `isError`. */
export const text = (obj: any) => ({
  content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
  ...(obj && typeof obj === "object" && !Array.isArray(obj) && "error" in obj
    ? { isError: true }
    : {}),
});

/** Standard Freshdesk page-based pagination args. */
export const pageArgs = {
  page: z.number().int().min(1).optional().default(1).describe("Page number, starts at 1."),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(30)
    .describe("Items per page (max 100)."),
};

/** Optional language suffix for multilingual Knowledge Base endpoints. */
export const langArg = z
  .string()
  .optional()
  .describe(
    "Optional language code (e.g. 'fr', 'es', 'pt-BR') to target a translated version. Omit for the primary language.",
  );
export const lang = (l?: string) => (l ? `/${encodeURIComponent(l)}` : "");

export function validate<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  data: unknown,
): { ok: true; data: T } | { ok: false; reply: ReturnType<typeof text> } {
  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    reply: text({
      error: "Validation error",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message,
      })),
    }),
  };
}

type ToolResult = ReturnType<typeof text> | CallToolResult;

/**
 * Thin wrapper around `server.registerTool`.
 * Args are inferred with zod v3's own `objectOutputType` instead of the SDK's zod v3/v4
 * compat `ToolCallback`, whose conditional types make tsc run out of memory on ~200 tools.
 */
export function tool<S extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: S,
  cb: (args: z.objectOutputType<S, ZodTypeAny>) => ToolResult | Promise<ToolResult>,
) {
  return server.registerTool(name, { description, inputSchema } as any, cb as any);
}
