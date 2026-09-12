import type { MediaAbilities } from "./media-types.js";

export class NovaMediaRegistry {
  private readonly abilities: MediaAbilities;

  constructor(abilities: MediaAbilities = {}) {
    this.abilities = abilities;
  }

  get(): MediaAbilities {
    return this.abilities;
  }

  has(name: keyof MediaAbilities): boolean {
    return typeof this.abilities[name] === "function";
  }
}
