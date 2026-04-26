/**
 * The ApplicationV2 interface for reviewing character audit logs.
 */

import { StateManager } from "../data/StateManager.js";
import { exportPlayerLogs } from "../utils/exportHelpers.js";
import { MODULE_ID, SETTING_KEYS } from "../config/settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
     * Transforms the flat log array into a structured array grouped by player.
     * @returns {Array<object>}
     */
    #buildPlayerContext() {
        const logs = StateManager.getLogs();
        const playersMap = new Map();
        const trackGMs = game.settings.get(MODULE_ID, SETTING_KEYS.TRACK_GM);

        // Dynamically include the GM in the sidebar if tracking is enabled
        game.users.forEach((user) => {
            if (!user.isGM || trackGMs) {
                playersMap.set(user.id, {
                    id: user.id,
                    name: user.isGM ? `${user.name} (GM)` : user.name, // Adds a helpful tag to the UI
                    logs: [],
                });
            }
        });

        logs.forEach((log) => {
            if (playersMap.has(log.userId)) {
                playersMap.get(log.userId).logs.push(log);
            }
        });

        return Array.from(playersMap.values());
    }

    /**
     * Action handler: Wipes the entire database of all logs.
     */
    static async #handleClearAll(event, target) {
        await StateManager.clearLogs();
        this.render({ force: false });
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
}
