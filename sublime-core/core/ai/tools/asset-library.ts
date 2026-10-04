import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";
import { resolveWorkspacePath } from "./workspace-path.js";

/** License values accepted by NOVA's automatic asset-selection policy. */
export type AssetLicense =
  | "local"
  | "public_domain"
  | "creative_commons"
  | "royalty_free"
  | "provider_permitted"
  | "unknown"
  | "restricted";

export type AssetMediaType = "image" | "video";
export type ProceduralKind =
  | "generic"
  | "ai_video"
  | "sky_scattering"
  | "cpu_architecture";

export interface VisualAssetRequest {
  sceneDescription: string;
  topic: string;
  keywords?: string[];
  preferredMediaType?: AssetMediaType;
  durationSeconds?: number;
  visualRole?: string;
}

export interface OnlineAssetCandidate {
  id: string;
  title: string;
  sourceUrl: string;
  downloadUrl: string;
  mediaType: AssetMediaType;
  extension?: string;
  author?: string;
  license: AssetLicense;
  licenseLabel: string;
  licenseUrl?: string;
  keywords?: string[];
}

export interface DownloadedAsset {
  data: Uint8Array;
  mediaType?: AssetMediaType;
  extension?: string;
  contentType?: string;
}

/** Online sources stay behind this interface so providers can be added safely. */
export interface AssetProvider {
  name: string;
  isConfigured(): boolean;
  search(request: VisualAssetRequest): Promise<OnlineAssetCandidate[]>;
  download(candidate: OnlineAssetCandidate): Promise<DownloadedAsset>;
}

export interface AssetRecord {
  id: string;
  location: string;
  filename: string;
  extension: string;
  mediaType: AssetMediaType;
  source: "local" | "online";
  license: AssetLicense;
  fileSize: number;
  keywords: string[];
  width?: number;
  height?: number;
  durationSeconds?: number;
  provider?: string;
  originalAssetId?: string;
  sourceUrl?: string;
  author?: string;
  licenseLabel?: string;
  licenseUrl?: string;
  provenancePath?: string;
}

export interface AssetProvenance {
  sourceUrl: string;
  provider: string;
  assetId: string;
  author?: string;
  license: AssetLicense;
  licenseLabel: string;
  licenseUrl?: string;
  downloadedAt: string;
  localFilename: string;
  mediaType: AssetMediaType;
  extension: string;
  keywords: string[];
}

export interface AssetResolutionAttempt {
  source: "local" | "provider";
  provider?: string;
  outcome: "selected" | "unavailable" | "rejected" | "failed" | "cached";
  detail: string;
}

export interface AssetResolution {
  status: "local" | "online" | "procedural";
  asset?: AssetRecord;
  reason: string;
  attempts: AssetResolutionAttempt[];
  proceduralKind: ProceduralKind;
}

export interface AssetResolverOptions {
  providers?: AssetProvider[];
  now?: () => Date;
}

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".avif",
]);
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".avi",
  ".mkv",
]);
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

function safeExtension(value: string | undefined, mediaType?: AssetMediaType): string {
  const normalized = value?.trim().toLowerCase().replace(/^([^.]*)$/, ".$1") ?? "";
  if (IMAGE_EXTENSIONS.has(normalized) || VIDEO_EXTENSIONS.has(normalized)) return normalized;
  return mediaType === "video" ? ".mp4" : ".jpg";
}

function mediaTypeForExtension(extension: string): AssetMediaType | undefined {
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return undefined;
}

function safeString(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 56);
  return cleaned || fallback;
}

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function safeAssetFilename(provider: string, candidate: OnlineAssetCandidate): string {
  const urlExtension = (() => {
    try {
      return path.extname(new URL(candidate.downloadUrl).pathname);
    } catch {
      return "";
    }
  })();
  const extension = safeExtension(candidate.extension || urlExtension, candidate.mediaType);
  return `${safeString(provider, "provider")}-${safeString(candidate.title || candidate.id, "asset")}-${checksum(`${provider}:${candidate.id}:${candidate.downloadUrl}`)}${extension}`;
}

function deriveKeywords(...values: Array<string | undefined>): string[] {
  const ignored = new Set([
    "the", "and", "for", "with", "from", "this", "that", "into", "about", "video", "image",
    "scene", "asset", "visual", "media", "jpg", "jpeg", "png", "webp", "mp4", "webm",
  ]);
  const words = values
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/))
    .filter((word) => word.length > 1 && !ignored.has(word));
  return [...new Set(words)];
}

function isPermitted(license: AssetLicense): boolean {
  return license !== "unknown" && license !== "restricted";
}

function normalizeLicense(value: unknown): AssetLicense {
  const normalized = String(value ?? "unknown").trim().toLowerCase().replace(/[ -]+/g, "_");
  const values: AssetLicense[] = [
    "local", "public_domain", "creative_commons", "royalty_free", "provider_permitted", "unknown", "restricted",
  ];
  return values.includes(normalized as AssetLicense) ? normalized as AssetLicense : "unknown";
}

function proceduralKindFor(request: VisualAssetRequest): ProceduralKind {
  const words = deriveKeywords(request.topic, request.sceneDescription, ...(request.keywords ?? []));
  if (words.some((word) => ["ai", "artificial", "generative", "prompt", "neural", "model"].includes(word))) {
    return "ai_video";
  }
  if (words.some((word) => ["sky", "atmosphere", "scattering", "rayleigh", "sunlight", "blue"].includes(word))) {
    return "sky_scattering";
  }
  if (words.some((word) => ["cpu", "processor", "chip", "instruction", "compute"].includes(word))) {
    return "cpu_architecture";
  }
  return "generic";
}

function scoreAsset(record: AssetRecord, request: VisualAssetRequest): number {
  if (request.preferredMediaType && record.mediaType !== request.preferredMediaType) return -1;
  const wanted = new Set(deriveKeywords(request.topic, request.sceneDescription, ...(request.keywords ?? [])));
  const available = new Set(record.keywords);
  let score = 0;
  for (const word of wanted) {
    if (available.has(word)) score += 3;
    else if ([...available].some((candidate) => candidate.startsWith(word) || word.startsWith(candidate))) score += 1;
  }
  if (request.durationSeconds && record.durationSeconds) {
    score += record.durationSeconds >= Math.min(1, request.durationSeconds) ? 1 : 0;
  }
  return score;
}

async function assetDirectories(): Promise<{ assets: string; metadata: string }> {
  const assets = await resolveWorkspacePath("assets");
  const metadata = await resolveWorkspacePath("assets/metadata");
  await Promise.all([fs.mkdir(assets, { recursive: true }), fs.mkdir(metadata, { recursive: true })]);
  return { assets, metadata };
}

async function walkFiles(root: string, directory = root): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (path.resolve(fullPath) !== path.resolve(root, "metadata")) files.push(...await walkFiles(root, fullPath));
      continue;
    }
    if (entry.isFile() && mediaTypeForExtension(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

async function readProvenance(metadataDirectory: string): Promise<Map<string, AssetProvenance>> {
  const result = new Map<string, AssetProvenance>();
  const entries = await fs.readdir(metadataDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
    const filename = path.join(metadataDirectory, entry.name);
    try {
      const stat = await fs.stat(filename);
      if (stat.size > MAX_METADATA_BYTES) continue;
      const parsed = JSON.parse(await fs.readFile(filename, "utf8")) as Partial<AssetProvenance>;
      if (!parsed.localFilename || !parsed.provider || !parsed.assetId || !parsed.sourceUrl) continue;
      result.set(path.basename(parsed.localFilename), {
        sourceUrl: parsed.sourceUrl,
        provider: parsed.provider,
        assetId: parsed.assetId,
        author: parsed.author,
        license: normalizeLicense(parsed.license),
        licenseLabel: typeof parsed.licenseLabel === "string" ? parsed.licenseLabel : String(parsed.license ?? "unknown"),
        licenseUrl: parsed.licenseUrl,
        downloadedAt: typeof parsed.downloadedAt === "string" ? parsed.downloadedAt : "",
        localFilename: path.basename(parsed.localFilename),
        mediaType: parsed.mediaType === "video" ? "video" : "image",
        extension: safeExtension(parsed.extension, parsed.mediaType === "video" ? "video" : "image"),
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((value): value is string => typeof value === "string") : [],
      });
    } catch {
      // A stale or hand-edited metadata file must not block the asset library.
    }
  }
  return result;
}

export async function inspectAssetLibrary(): Promise<AssetRecord[]> {
  const { assets, metadata } = await assetDirectories();
  const [files, provenance] = await Promise.all([walkFiles(assets), readProvenance(metadata)]);
  const records: AssetRecord[] = [];
  for (const filename of files) {
    const extension = path.extname(filename).toLowerCase();
    const mediaType = mediaTypeForExtension(extension);
    if (!mediaType) continue;
    const stat = await fs.stat(filename);
    const basename = path.basename(filename);
    const stored = provenance.get(basename);
    const location = path.relative(assets, filename).split(path.sep).join("/");
    records.push({
      id: stored?.assetId ?? `local:${location}`,
      location: `assets/${location}`,
      filename: basename,
      extension,
      mediaType,
      source: stored ? "online" : "local",
      license: stored?.license ?? "local",
      fileSize: stat.size,
      keywords: [...new Set([...deriveKeywords(location), ...(stored?.keywords ?? [])])],
      ...(stored ? {
        provider: stored.provider,
        originalAssetId: stored.assetId,
        sourceUrl: stored.sourceUrl,
        author: stored.author,
        licenseLabel: stored.licenseLabel,
        licenseUrl: stored.licenseUrl,
        provenancePath: `assets/metadata/${path.basename(basename, extension)}.json`,
      } : {}),
    });
  }
  return records;
}

function selectLocal(records: AssetRecord[], request: VisualAssetRequest): AssetRecord | undefined {
  const candidates = records
    .filter((record) => isPermitted(record.license))
    .map((record) => ({ record, score: scoreAsset(record, request) }))
    .filter((candidate) => candidate.score >= 2)
    .sort((a, b) => b.score - a.score || a.record.location.localeCompare(b.record.location));
  return candidates[0]?.record;
}

function isPlausibleDownload(data: Uint8Array, extension: string, mediaType: AssetMediaType): boolean {
  if (data.byteLength < 12 || data.byteLength > MAX_DOWNLOAD_BYTES) return false;
  const bytes = data;
  const starts = (...prefix: number[]) => prefix.every((value, index) => bytes[index] === value);
  if (mediaType === "image") {
    if ([".jpg", ".jpeg"].includes(extension)) return starts(0xff, 0xd8, 0xff);
    if (extension === ".png") return starts(0x89, 0x50, 0x4e, 0x47);
    if (extension === ".gif") return starts(0x47, 0x49, 0x46, 0x38);
    if (extension === ".webp") return starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (extension === ".avif") return String.fromCharCode(...bytes.slice(4, 12)).includes("ftyp");
    return false;
  }
  if ([".mp4", ".m4v", ".mov"].includes(extension)) return String.fromCharCode(...bytes.slice(4, 12)).includes("ftyp");
  if (extension === ".webm" || extension === ".mkv") return starts(0x1a, 0x45, 0xdf, 0xa3);
  return false;
}

async function writeProvenance(directory: string, filename: string, provenance: AssetProvenance): Promise<string> {
  const stem = path.basename(filename, path.extname(filename));
  const target = path.join(directory, `${stem}.json`);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
  return target;
}

function recordFromCandidate(candidate: OnlineAssetCandidate, filename: string, size: number, provider: string, provenancePath: string): AssetRecord {
  const extension = safeExtension(candidate.extension || path.extname(new URL(candidate.downloadUrl).pathname), candidate.mediaType);
  return {
    id: candidate.id,
    location: `assets/${filename}`,
    filename,
    extension,
    mediaType: candidate.mediaType,
    source: "online",
    license: candidate.license,
    fileSize: size,
    keywords: deriveKeywords(candidate.title, ...(candidate.keywords ?? [])),
    provider,
    originalAssetId: candidate.id,
    sourceUrl: candidate.sourceUrl,
    author: candidate.author,
    licenseLabel: candidate.licenseLabel,
    licenseUrl: candidate.licenseUrl,
    provenancePath: `assets/metadata/${path.basename(filename, extension)}.json`,
  };
}

async function acquireCandidate(
  provider: AssetProvider,
  candidate: OnlineAssetCandidate,
  records: AssetRecord[],
  now: () => Date,
): Promise<{ record?: AssetRecord; cached: boolean; detail?: string }> {
  if (!isPermitted(candidate.license) || !candidate.licenseLabel.trim()) {
    return { cached: false, detail: "candidate has no permitted license information" };
  }
  const existing = records.find((record) => record.provider === provider.name && record.originalAssetId === candidate.id && isPermitted(record.license));
  if (existing) return { record: existing, cached: true };

  const { assets, metadata } = await assetDirectories();
  const filename = safeAssetFilename(provider.name, candidate);
  const target = await resolveWorkspacePath(`assets/${filename}`);
  const extension = safeExtension(candidate.extension || path.extname(new URL(candidate.downloadUrl).pathname), candidate.mediaType);
  let downloaded: DownloadedAsset;
  try {
    downloaded = await provider.download(candidate);
  } catch (error) {
    return { cached: false, detail: error instanceof Error ? error.message : String(error) };
  }
  const mediaType = downloaded.mediaType ?? candidate.mediaType;
  const downloadedExtension = safeExtension(downloaded.extension || extension, mediaType);
  if (mediaType !== candidate.mediaType || !isPlausibleDownload(downloaded.data, downloadedExtension, mediaType)) {
    return { cached: false, detail: "download failed media validation" };
  }
  try {
    await fs.access(target);
  } catch {
    const temporary = `${target}.part`;
    await fs.writeFile(temporary, downloaded.data);
    await fs.rename(temporary, target);
  }
  const provenance: AssetProvenance = {
    sourceUrl: candidate.sourceUrl,
    provider: provider.name,
    assetId: candidate.id,
    author: candidate.author,
    license: candidate.license,
    licenseLabel: candidate.licenseLabel,
    licenseUrl: candidate.licenseUrl,
    downloadedAt: now().toISOString(),
    localFilename: filename,
    mediaType,
    extension: downloadedExtension,
    keywords: deriveKeywords(candidate.title, ...(candidate.keywords ?? [])),
  };
  const provenancePath = await writeProvenance(metadata, filename, provenance);
  const stat = await fs.stat(target);
  return { record: recordFromCandidate({ ...candidate, mediaType, extension: downloadedExtension }, filename, stat.size, provider.name, provenancePath), cached: false };
}

/** Resolve a scene through local library, configured permitted providers, then procedural fallback. */
export async function resolveVisualAsset(
  request: VisualAssetRequest,
  options: AssetResolverOptions = {},
): Promise<AssetResolution> {
  const attempts: AssetResolutionAttempt[] = [];
  const kind = proceduralKindFor(request);
  const records = await inspectAssetLibrary();
  const local = selectLocal(records, request);
  if (local) {
    attempts.push({ source: "local", outcome: "selected", detail: local.location });
    return { status: "local", asset: local, reason: "Matched a permitted workspace asset.", attempts, proceduralKind: kind };
  }
  attempts.push({ source: "local", outcome: "unavailable", detail: "No sufficiently relevant permitted workspace asset." });

  for (const provider of options.providers ?? configuredAssetProviders()) {
    if (!provider.isConfigured()) {
      attempts.push({ source: "provider", provider: provider.name, outcome: "unavailable", detail: "Provider is not configured." });
      continue;
    }
    let candidates: OnlineAssetCandidate[];
    try {
      candidates = await provider.search(request);
    } catch (error) {
      attempts.push({ source: "provider", provider: provider.name, outcome: "failed", detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!candidates.length) {
      attempts.push({ source: "provider", provider: provider.name, outcome: "unavailable", detail: "No permitted candidates returned." });
      continue;
    }
    for (const candidate of candidates.slice(0, 3)) {
      const acquired = await acquireCandidate(provider, candidate, records, options.now ?? (() => new Date()));
      if (acquired.record) {
        attempts.push({ source: "provider", provider: provider.name, outcome: acquired.cached ? "cached" : "selected", detail: acquired.record.location });
        return {
          status: "online",
          asset: acquired.record,
          reason: acquired.cached ? "Reused a permitted cached provider asset." : "Downloaded a permitted provider asset with provenance.",
          attempts,
          proceduralKind: kind,
        };
      }
      attempts.push({ source: "provider", provider: provider.name, outcome: "rejected", detail: acquired.detail ?? "Candidate was rejected." });
    }
  }
  return {
    status: "procedural",
    reason: "No suitable local or configured permitted online asset was available.",
    attempts,
    proceduralKind: kind,
  };
}

function commonsLicense(value: string): AssetLicense {
  const license = value.toLowerCase();
  if (license.includes("public domain") || license.includes("cc0")) return "public_domain";
  if (license.includes("creative commons") || /\bcc[- ]by/.test(license)) return "creative_commons";
  return "unknown";
}

/** Opt-in Wikimedia Commons provider. Its response includes explicit source license fields. */
export class WikimediaCommonsProvider implements AssetProvider {
  readonly name = "wikimedia_commons";

  isConfigured(): boolean {
    return process.env.NOVA_WIKIMEDIA_COMMONS_ENABLED?.trim().toLowerCase() === "true";
  }

  async search(request: VisualAssetRequest): Promise<OnlineAssetCandidate[]> {
    const query = deriveKeywords(request.topic, request.sceneDescription, ...(request.keywords ?? [])).slice(0, 8).join(" ");
    if (!query) return [];
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrsearch", query);
    url.searchParams.set("gsrnamespace", "6");
    url.searchParams.set("gsrlimit", "4");
    url.searchParams.set("prop", "imageinfo");
    url.searchParams.set("iiprop", "url|extmetadata");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Wikimedia Commons search failed with HTTP ${response.status}.`);
    const payload = await response.json() as { query?: { pages?: Record<string, { pageid: number; title: string; imageinfo?: Array<{ url?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }> }> } };
    return Object.values(payload.query?.pages ?? {}).flatMap((page) => {
      const info = page.imageinfo?.[0];
      const metadata = info?.extmetadata;
      const label = String(metadata?.LicenseShortName?.value ?? metadata?.UsageTerms?.value ?? "").replace(/<[^>]*>/g, "").trim();
      const license = commonsLicense(label);
      const downloadUrl = info?.url;
      if (!downloadUrl || !isPermitted(license)) return [];
      return [{
        id: String(page.pageid),
        title: page.title.replace(/^File:/i, ""),
        sourceUrl: info?.descriptionurl ?? downloadUrl,
        downloadUrl,
        mediaType: "image" as const,
        extension: path.extname(new URL(downloadUrl).pathname),
        author: String(metadata?.Artist?.value ?? "").replace(/<[^>]*>/g, "").trim() || undefined,
        license,
        licenseLabel: label,
        licenseUrl: String(metadata?.LicenseUrl?.value ?? "").trim() || undefined,
        keywords: deriveKeywords(page.title),
      }];
    });
  }

  async download(candidate: OnlineAssetCandidate): Promise<DownloadedAsset> {
    const response = await fetch(candidate.downloadUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Wikimedia Commons download failed with HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_DOWNLOAD_BYTES) throw new Error("Provider asset exceeds the download limit.");
    const data = new Uint8Array(await response.arrayBuffer());
    return { data, mediaType: candidate.mediaType, extension: candidate.extension, contentType: response.headers.get("content-type") ?? undefined };
  }
}

export function configuredAssetProviders(): AssetProvider[] {
  return [new WikimediaCommonsProvider()];
}

export const assetLibraryTool: Tool = {
  name: "asset_library",
  description: "Resolve a NOVA visual through workspace assets, permitted configured providers, then a structured procedural fallback.",
  parameters: {
    type: "object",
    properties: {
      sceneDescription: { type: "string" },
      topic: { type: "string" },
      keywords: { type: "array", items: { type: "string" } },
      preferredMediaType: { type: "string", enum: ["image", "video"] },
      durationSeconds: { type: "number" },
      visualRole: { type: "string" },
    },
    required: ["sceneDescription", "topic"],
    additionalProperties: false,
  },
  async handler(args) {
    if (typeof args.sceneDescription !== "string" || typeof args.topic !== "string") {
      throw new Error("asset_library requires sceneDescription and topic.");
    }
    return JSON.stringify(await resolveVisualAsset({
      sceneDescription: args.sceneDescription,
      topic: args.topic,
      keywords: Array.isArray(args.keywords) ? args.keywords.filter((value): value is string => typeof value === "string") : undefined,
      preferredMediaType: args.preferredMediaType === "video" ? "video" : args.preferredMediaType === "image" ? "image" : undefined,
      durationSeconds: typeof args.durationSeconds === "number" ? args.durationSeconds : undefined,
      visualRole: typeof args.visualRole === "string" ? args.visualRole : undefined,
    }));
  },
};
