export function normalizeHash(hash: unknown): string
export function matchRoute(
  routes: unknown[],
  hash: string,
): { route: { name: string; pattern: string; viewNames: string[] }; args: Record<string, string> } | null
