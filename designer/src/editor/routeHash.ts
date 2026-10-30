/** A hash that opens the page of a route pattern: "order/{orderId}" -> "order/1"; optional parts and query parameters are dropped. */
export function hashFor(pattern: string): string {
  return pattern
    .replace(/\{\?[^}]*\}/g, '')
    .replace(/:\?[^:]*:/g, '')
    .replace(/:[^:]+:/g, '')
    .replace(/\{[^}]+\}/g, '1')
    .replace(/\/$/, '')
}
