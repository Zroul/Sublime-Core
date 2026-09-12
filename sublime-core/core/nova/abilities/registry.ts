import type { NovaAbilities } from "./types.js";
import { fetchSource } from "./http-source.js";

export function createNovaAbilities(): NovaAbilities {
  return {
    sourceFetch: fetchSource,
  };
}
