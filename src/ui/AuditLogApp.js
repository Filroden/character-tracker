/**
 * The ApplicationV2 interface for reviewing character audit logs.
 */

import { StateManager } from "../data/StateManager.js";
import { exportPlayerLogs } from "../utils/exportHelpers.js";
import { MODULE_ID, SETTING_KEYS } from "../config/settings.js";
import { SystemMapper } from "../systems/SystemMapper.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class AuditLogApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "character-tracker-app",
        classes: ["character-tracker-window"],
        tag: "form",
        window: {
            icon: "character-tracker-icon list",
            title: "character-tracker.ui.windowTitle",
            resizable: true,
        },
        position: {
            width: 900,
            height: 500,
        },
        actions: {
            clearAll: AuditLogApp.#handleClearAll,
            clearPlayer: AuditLogApp.#handleClearPlayer,
            exportPlayer: AuditLogApp.#handleExportPlayer,
            scrollToPlayer: AuditLogApp.#handleScrollToPlayer,
            refreshLog: AuditLogApp.#handleRefreshLog,
        },
    };

    static PARTS = {
        main: {
            template: "modules/character-tracker/templates/audit-log.hbs",
        },
    };

    /**
     * Prepares the data supplied to the Handlebars template.
     */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.players = this.#buildPlayerContext();
        return context;
    }

    /**
     * Hook that fires after the application is rendered into the DOM.
     * Ideal for applying root-level element modifications.
     */
    _onRender(context, options) {
        super._onRender(context, options);
        AuditLogApp.#applyRTLSupport(this.element);
    }

    /**
     * Applies RTL directionality if the active language requires it.
     * @param {HTMLElement} element - The root application element.
     */
    static #applyRTLSupport(element) {
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        if (!rtlLanguages.includes(game.i18n.lang)) return;

        element.setAttribute("dir", "rtl");
        element.classList.add("rtl");
    }

    /**
     * Transforms the flat log array into a structured array grouped by player and character.
     * @returns {Array<object>}
     */
    #buildPlayerContext() {
        const logs = StateManager.getLogs();
        const playersMap = this.#initializePlayersMap();

        logs.forEach((log) => this.#aggregateLog(playersMap, log));

        return this.#formatContextData(playersMap);
    }

    /**
     * Generates the baseline player map with empty statistic containers.
     * @returns {Map<string, object>}
     */
    #initializePlayersMap() {
        const playersMap = new Map();
        const trackGMs = game.settings.get(MODULE_ID, SETTING_KEYS.TRACK_GM);

        game.users.forEach((user) => {
            if (!user.isGM || trackGMs) {
                playersMap.set(user.id, {
                    id: user.id,
                    name: user.isGM ? `${user.name} (GM)` : user.name,
                    stats: { totalChanges: 0, itemsModified: 0, lastActivity: null },
                    charactersMap: new Map(),
                });
            }
        });

        return playersMap;
    }

    /**
     * Processes a single log entry, updating stats and sorting it into the correct character bin.
     */
    #aggregateLog(playersMap, log) {
        const player = playersMap.get(log.userId);
        if (!player) return;

        const displayLog = this.#translateLog(log);

        this.#updatePlayerStats(player.stats, displayLog);
        this.#assignLogToCharacter(player.charactersMap, displayLog);
    }

    /**
     * Safely translates system keys for UI presentation without mutating the database object.
     */
    #translateLog(log) {
        const displayLog = { ...log };

        if (displayLog.action !== "Data Modified") return displayLog;

        displayLog.detail = displayLog.detail
            .split(" | ")
            .map((part) => {
                const [rawKey, val] = part.split(" ➔ ");

                if (val !== undefined && rawKey.startsWith("system.")) {
                    const translatedKey = SystemMapper.translate(rawKey);

                    // Appends the raw key in brackets only if a translation was successfully found
                    const displayKey = translatedKey === rawKey ? rawKey : `${translatedKey} (${rawKey})`;

                    return `${displayKey} ➔ ${val}`;
                }
                return part;
            })
            .join(" | ");

        return displayLog;
    }

    /**
     * Increments the high-level statistics for a player.
     */
    #updatePlayerStats(stats, log) {
        stats.totalChanges++;

        // Logs are chronological; overwriting this continuously yields the most recent timestamp
        stats.lastActivity = log.timestamp;
    }

    /**
     * Groups a log into the specific character's array.
     */
    #assignLogToCharacter(charactersMap, log) {
        if (!charactersMap.has(log.actorName)) {
            charactersMap.set(log.actorName, {
                name: log.actorName,
                logs: [],
            });
        }
        charactersMap.get(log.actorName).logs.push(log);
    }

    /**
     * Converts the Maps into flat Arrays for Handlebars iteration.
     */
    #formatContextData(playersMap) {
        const contextArray = Array.from(playersMap.values());

        contextArray.forEach((player) => {
            player.characters = Array.from(player.charactersMap.values());
            delete player.charactersMap;
        });

        return contextArray;
    }

    /**
     * Action handler: Prompts the user before globally clearing all logs.
     */
    static async #handleClearAll(event, target) {
        const confirm = await DialogV2.confirm({
            window: {
                title: game.i18n.localize("character-tracker.ui.clearAllTitle"),
            },
            content: `<p>${game.i18n.localize("character-tracker.ui.clearAllConfirm")}</p>`,
            modal: true,
            rejectClose: false,
        });

        if (confirm) {
            await StateManager.clearLogs();
            await this.render({ force: false });
        }
    }

    /**
     * Action handler: Wipes the logs for a specific player.
     */
    static async #handleClearPlayer(event, target) {
        const userId = target.dataset.userId;
        if (!userId) return;

        await StateManager.clearLogs(userId);
        this.render({ force: false });
    }

    /**
     * Action handler: Exports the logs for a specific player to a text file.
     */
    static #handleExportPlayer(event, target) {
        const userId = target.dataset.userId;
        if (!userId) return;

        const user = game.users.get(userId);
        if (!user) return;

        exportPlayerLogs(userId, user.name);
    }

    /**
     * Action handler: Smoothly scrolls the main content to the targeted player section.
     */
    static #handleScrollToPlayer(event, target) {
        const playerId = target.dataset.target;
        if (!playerId) return;

        // Native DOM traversal to locate the specific section ID
        const section = this.element.querySelector(`#character-tracker-player-${playerId}`);
        if (!section) return;

        section.scrollIntoView({ behavior: "smooth" });
    }

    /**
     * Action handler: Manually recalculates state and refreshes the application UI.
     */
    static async #handleRefreshLog(event, target) {
        await this.render({ force: false });
    }
}
