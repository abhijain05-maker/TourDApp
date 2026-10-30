// Types for live-snippet.mjs (plain JavaScript shared by the server, the designer and the tests).
export function jsonForScript(value: unknown): string
export function playerAsPredefine(source: string): string
export function helpAsPredefine(source: string): string
export function buildInlineSnippet(args: { playerSource: string; tour: unknown }): string
export function buildLoaderSnippet(args: { origin: string; tourId: string; token?: string }): string
export function toBookmarklet(snippet: string): string
export function buildRecorderSnippet(args: { recorderSource: string }): string
