/**
 * Handles the registration and configuration of all module settings.
 */

export const MODULE_ID = "character-tracker";

export const SETTING_KEYS = {
    LOG_STORE: "logStore",
    TRACK_GM: "trackGM",
    RECORD_WITHOUT_GM: "recordWithoutGM",
    ACCENT: "accent",
};

/**
 * The accent hues the window can use. Each user picks one from the window's Appearance menu;
 * light or dark always follows Foundry's own interface theme (see character-tracker-theme.css).
 */
export const ACCENTS = {
    GOLD: "gold",
    BLUE: "blue",
};

/**
 * Keys used for data the module stores in document flags (under `flags.character-tracker`).
 */
export const FLAG_KEYS = {
    PENDING_LOGS: "pendingLogs",
};

/**
 * Default for the "record changes when no GM is online" setting.
 * When true, a player's own client queues their changes on the actor whenever no GM is connected,
 * and the GM client merges them into the main log later. When false, the behaviour is opt-in and
 * changes made with no GM connected are not recorded unless a GM enables the setting.
 */
export const RECORD_WITHOUT_GM_DEFAULT = true;

export const SYSTEM_CONFIG = {
    MAX_ENTRIES: 500,
    SAVE_DELAY_MS: 500,
    MAX_PENDING_ENTRIES: 500,
};

/**
 * Returns the current user's accent hue, falling back to gold if the stored value is not one of
 * ACCENTS (for example, a value written by a later version of the module that added a hue).
 * @returns {string} - One of ACCENTS.
 */
export function getAccent() {
    const accent = game.settings.get(MODULE_ID, SETTING_KEYS.ACCENT);
    return Object.values(ACCENTS).includes(accent) ? accent : ACCENTS.GOLD;
}

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

    // User-facing toggle for recording changes while no GM is connected
    game.settings.register(MODULE_ID, SETTING_KEYS.RECORD_WITHOUT_GM, {
        name: game.i18n.localize("character-tracker.settings.recordWithoutGM.name"),
        hint: game.i18n.localize("character-tracker.settings.recordWithoutGM.hint"),
        scope: "world",
        config: true,
        type: Boolean,
        default: RECORD_WITHOUT_GM_DEFAULT,
    });

    // Per-user accent hue. Hidden from the settings window because it is chosen from the
    // Appearance menu in the tracker window itself, where its effect is seen at once.
    game.settings.register(MODULE_ID, SETTING_KEYS.ACCENT, {
        name: game.i18n.localize("character-tracker.settings.accent.name"),
        hint: game.i18n.localize("character-tracker.settings.accent.hint"),
        scope: "client",
        config: false,
        type: String,
        choices: {
            [ACCENTS.GOLD]: game.i18n.localize("character-tracker.ui.accentGold"),
            [ACCENTS.BLUE]: game.i18n.localize("character-tracker.ui.accentBlue"),
        },
        default: ACCENTS.GOLD,
    });
}
