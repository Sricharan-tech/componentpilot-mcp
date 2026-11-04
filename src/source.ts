import { z } from "zod";

export class ComponentPilotError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false, public readonly details?: Record<string, unknown>) { super(message); }
}

export const SourceConfigSchema = z.object({ id: z.string().regex(/^[a-z0-9-]+$/i), catalogue_url: z.string().url(), design_systems_url: z.string().url().optional(), terms_url: z.string().url().optional(), robots_url: z.string().url().optional() });
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

// Configuration only: component names and third-party implementation URLs are discovered live.
const DEFAULT_SOURCES: SourceConfig[] = [{ id: "component-gallery", catalogue_url: "https://component.gallery/components/", design_systems_url: "https://component.gallery/design-systems", robots_url: "https://component.gallery/robots.txt" }];

export function configuredSources(): SourceConfig[] {
  const raw = process.env.COMPONENTPILOT_SOURCES?.trim();
  if (!raw) return DEFAULT_SOURCES;
  try { const sources = z.array(SourceConfigSchema).min(1).max(8).parse(JSON.parse(raw)); for (const source of sources) assertHttps(source.catalogue_url, "source catalogue"); return sources; }
  catch (error) { throw new ComponentPilotError("INVALID_SOURCE_CONFIG", error instanceof Error ? error.message : "COMPONENTPILOT_SOURCES is invalid."); }
}
export function findSource(id?: string): SourceConfig { const sources = configuredSources(); if (!id) return sources[0]; const source = sources.find((item) => item.id === id); if (!source) throw new ComponentPilotError("UNKNOWN_SOURCE", `Unknown source ${JSON.stringify(id)}. Configure it through COMPONENTPILOT_SOURCES.`); return source; }
export function assertHttps(value: string, label = "URL"): URL { let url: URL; try { url = new URL(value); } catch { throw new ComponentPilotError("INVALID_URL", `${label} is not a valid URL.`); } if (url.protocol !== "https:" || url.username || url.password || url.port) throw new ComponentPilotError("UNSAFE_URL", `${label} must be a plain HTTPS URL.`); return url; }
export function isSameOriginChild(candidate: string, sourceUrl: string): boolean { try { return assertHttps(candidate).origin === assertHttps(sourceUrl).origin; } catch { return false; } }

export function assertFreshTimestamp(value: string): void {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new ComponentPilotError("INVALID_SOURCE_EVIDENCE", "The source response has no valid retrieval timestamp.");
  const maxAge = Number(process.env.COMPONENTPILOT_MAX_SOURCE_AGE_MS ?? 300_000);
  if (!Number.isFinite(maxAge) || maxAge < 0) throw new ComponentPilotError("INVALID_SOURCE_CONFIG", "COMPONENTPILOT_MAX_SOURCE_AGE_MS must be a non-negative number.");
  if (Date.now() - time > maxAge) throw new ComponentPilotError("STALE_SOURCE", "The retrieved source evidence is older than the configured freshness limit.", true);
}

export class BoundedCache {
  private readonly values = new Map<string, { expiresAt: number; value: unknown }>();
  constructor(private readonly ttlMs = Number(process.env.COMPONENTPILOT_CACHE_TTL_MS ?? 3_600_000), private readonly maxEntries = 100) {}
  get<T>(key: string): T | undefined { const hit = this.values.get(key); if (!hit || hit.expiresAt <= Date.now()) { this.values.delete(key); return undefined; } return hit.value as T; }
  set<T>(key: string, value: T): T { if (this.values.size >= this.maxEntries && !this.values.has(key)) this.values.delete(this.values.keys().next().value!); this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs }); return value; }
}
