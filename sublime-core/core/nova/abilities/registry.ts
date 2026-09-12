import type { NovaAbilities } from "./types.js";
import { fetchSource } from "./http-source.js";
import { webSearch } from "./web-search.js";

export function createNovaAbilities(): NovaAbilities {
  return {
    webSearch,
    sourceFetch: fetchSource,
  };
}
