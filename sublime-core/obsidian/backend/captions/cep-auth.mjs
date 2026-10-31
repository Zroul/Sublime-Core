const CEP_EXTENSION_IDS = new Set([
  "com.zroul.obsidian.panel",
  "com.zroul.obsidian.smoketest.5611c73bb73c4b11bf3128ca8e64519e.panel",
]);

export const CEP_EXTENSION_ID_HEADER = "x-obsidian-cep-extension-id";
export const CEP_EXTENSION_ID_ALLOW_HEADER = "Content-Type, X-Obsidian-CEP-Extension-Id";

// CEP 12 / Chromium 99 sends the file-backed panel's origin as "file://" and omits Referer.
const CEP_ORIGINS = new Set(["file://", "null"]);

function isAdobeCepRequest(request) {
  const headers = request.headers ?? {};
  return CEP_ORIGINS.has(headers.origin) &&
    /AdobeCEP\/\d+(?:\.\d+)*/i.test(headers["user-agent"] ?? "") &&
    headers["sec-fetch-mode"] === "cors";
}

export function isCepPanelRequest(request) {
  const headers = request.headers ?? {};
  // The ID comes from CEP's host bridge; a file origin alone is not treated as panel identity.
  return isAdobeCepRequest(request) &&
    CEP_EXTENSION_IDS.has(headers[CEP_EXTENSION_ID_HEADER]);
}

export function isCepTranscriptionPreflight(request) {
  if (!isAdobeCepRequest(request)) return false;
  const requestedHeaders = String(headersValue(request, "access-control-request-headers"))
    .split(",")
    .map((header) => header.trim().toLowerCase());
  return request.headers?.["access-control-request-method"] === "POST" &&
    requestedHeaders.includes("content-type") &&
    requestedHeaders.includes(CEP_EXTENSION_ID_HEADER);
}

function headersValue(request, name) {
  return request.headers?.[name] ?? "";
}

export function cepAllowedOrigin(request) {
  return CEP_ORIGINS.has(request.headers?.origin) ? request.headers.origin : "null";
}
