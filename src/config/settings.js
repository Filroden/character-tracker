/**
 * Handles the registration and configuration of all module settings.
 */

export const MODULE_ID = "character-tracker";

export const SETTING_KEYS = {
    LOG_STORE: "logStore",
    TRACK_GM: "trackGM", // <-- New key
};

export const SYSTEM_CONFIG = {
    MAX_ENTRIES: 500,
    SAVE_DELAY_MS: 500,
};

/**
 * Registers all module settings with the Foundry core environment.
 * This function must be executed during the Foundry 'init' hook.
 */
export function registerSettings() {
    // Hidden database array
    game.settings.register(MODULE_ID, SETTING_KEYS.LOG_STORE, {
        name: game.i18n.localize("character-tracker.settings.logStore.name"),
        hint: game.i18n.localize("character-tracker.settings.logStore.hint"),
        scope: "world",
        config: false,
        type: Array,
        default: [],
    });

    // User-facing GM tracking toggle
    game.settings.register(MODULE_ID, SETTING_KEYS.TRACK_GM, {
        name: game.i18n.localize("character-tracker.settings.trackGM.name"),
        hint: game.i18n.localize("character-tracker.settings.trackGM.hint"),
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
    });
}
