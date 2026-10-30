export const EXCLUDED_DIRS: string[]
export const BINARY_EXTENSIONS: Set<string>
export function exclusionReason(path: string): string | null
export function extensionOf(path: string): string
export function isBinaryPath(path: string): boolean
