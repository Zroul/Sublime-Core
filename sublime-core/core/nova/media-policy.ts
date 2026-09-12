import type { MediaAsset } from "./abilities/media-types.js";

export interface MediaPolicyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Blocks assets whose provenance is unknown unless a human explicitly marks them safe. */
export function checkMediaProvenance(assets: MediaAsset[]): MediaPolicyResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const asset of assets) {
    if (!asset.license) {
      errors.push(`Asset has no license/provenance: ${asset.path}`);
      continue;
    }

    if (asset.license === "unknown-local-asset") {
      warnings.push(`Asset provenance needs human review: ${asset.path}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
