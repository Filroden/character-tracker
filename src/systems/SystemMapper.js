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
     * Employs hierarchical fallback (e.g., checks 'a.b.c', then 'a.b', then 'a').
     * @param {string} rawKey - The flat dot-notation key.
     * @returns {string} - The localised string, or the raw key if no dictionary entry exists.
     */
    static translate(rawKey) {
        let searchKey = rawKey;

        while (searchKey !== "") {
            const mappedKey = SystemMapper.#dictionary[searchKey];

            if (mappedKey) {
                return game.i18n.localize(mappedKey);
            }

            // Find the last dot to step one level up the hierarchy
            const lastDotIndex = searchKey.lastIndexOf(".");

            // If no dots remain, we have exhausted the hierarchy
            if (lastDotIndex === -1) break;

            searchKey = searchKey.substring(0, lastDotIndex);
        }

        return rawKey;
    }
}
