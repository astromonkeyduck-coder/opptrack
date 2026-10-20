export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function cleanSearch(value: string): string {
  return value.slice(0, 120).replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().replace(/\s+/g, ' ');
}
export function pageNumber(value?: string): number {
  const number = Number(value || 1);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, 10000) : 1;
}
export function sourceIsStale(lastSuccess: string | null, cadenceSeconds: number | null, now = Date.now()): boolean {
  if (!lastSuccess) return true;
  const date = Date.parse(lastSuccess);
  return !Number.isFinite(date) || now - date > Math.max((cadenceSeconds || 3600) * 2000, 300_000);
}
