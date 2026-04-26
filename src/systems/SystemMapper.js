/**
 * Routes raw system keys to native system localisation strings.
 */

import { rmuDictionary } from "./rmu.js";
// Future imports: import { dnd5eDictionary } from "./dnd5e.js";

/**
 * A flat registry mapping native Foundry system IDs to their specific dictionaries.
 */
const SUPPORTED_SYSTEMS = {
    rmu: rmuDictionary,
    // "dnd5e": dnd5eDictionary
};

export class SystemMapper {
    static #dictionary = {};

    /**
     * Initialises the mapper based on the active Foundry system.
     * Executed during the Foundry 'ready' phase.
     */
    static initialize() {
        const systemId = game.system.id;

        // Natively assigns the correct dictionary, or an empty object if unsupported
        SystemMapper.#dictionary = SUPPORTED_SYSTEMS[systemId] || {};
    }

    /**
     * Translates a raw system key into a human-readable, localised string.
     * @param {string} rawKey - The flat dot-notation key (e.g., "system.hp.value").
     * @returns {string} - The localised string, or the raw key if no dictionary entry exists.
     */
    static translate(rawKey) {
        const mappedKey = SystemMapper.#dictionary[rawKey];
        if (!mappedKey) return rawKey;

        return game.i18n.localize(mappedKey);
    }
}
