export const API_REWRITE: {
  source: string
  function: { functionId: string; region: string }
}
export function withFunctionsRewrite<T extends { hosting: object }>(
  config: T
): T & { hosting: { rewrites: unknown[] } }
