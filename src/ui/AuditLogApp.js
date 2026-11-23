/**
 * The ApplicationV2 interface for reviewing character audit logs.
 */

import { StateManager } from "../data/StateManager.js";
import { exportPlayerLogs } from "../utils/exportHelpers.js";
import { MODULE_ID, SETTING_KEYS } from "../config/settings.js";
import { SystemMapper } from "../systems/SystemMapper.js";
import { CHANGE_SEPARATOR, VALUE_ARROW, defaultChangeLabel, formatChange } from "../utils/logFormatting.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class AuditLogApp extends HandlebarsApplicationMixin(ApplicationV2) {
    #viewMode = "chronological"; // Tracks the active UI state

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
            toggleView: AuditLogApp.#handleToggleView,
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

        // Destructure the newly returned object from the formatting loop
        const viewData = this.#buildPlayerContext();
        context.players = viewData.players;
        context.isCategorical = viewData.isCategorical;

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
     * For core data changes it also attaches `detailParts` (one { name, text } pair per changed
     * key), which the categorical view uses to file each change under its own stat.
     */
    #translateLog(log) {
        const displayLog = { ...log };

        if (displayLog.action !== "Data Modified") return displayLog;

        // Entries recorded before structured changes existed only carry the joined detail string
        displayLog.detailParts = Array.isArray(log.changes) ? AuditLogApp.#partsFromChanges(log.changes) : AuditLogApp.#partsFromLegacyDetail(log.detail);

        displayLog.detail = displayLog.detailParts.map((part) => part.text).join(CHANGE_SEPARATOR);

        return displayLog;
    }

    /**
     * Builds display parts from structured change records.
     * @param {Array<object>} changes - The change records stored on the log entry.
     * @returns {Array<{name: string, text: string}>}
     */
    static #partsFromChanges(changes) {
        return changes.map((change) => {
            const label = change.key.startsWith("system.") ? AuditLogApp.#translateKey(change.key) : defaultChangeLabel(change);
            return { name: label, text: formatChange(change, label) };
        });
    }

    /**
     * Builds display parts by parsing a legacy "key ➔ value | key ➔ value" detail string.
     * @param {string} detail - The stored detail string.
     * @returns {Array<{name: string, text: string}>}
     */
    static #partsFromLegacyDetail(detail) {
        return detail.split(CHANGE_SEPARATOR).map((part) => {
            const [rawKey, val] = part.split(VALUE_ARROW);

            // Parts without an arrow (such as "Token Settings Modified") are their own label
            if (val === undefined) return { name: part, text: part };

            const label = AuditLogApp.#translateKey(rawKey);
            return { name: label, text: `${label}${VALUE_ARROW}${val}` };
        });
    }

    /**
     * Translates a raw system key, appending the raw key in brackets only if a translation was
     * successfully found. Non-system keys are returned unchanged.
     * @param {string} rawKey - The flattened key.
     * @returns {string}
     */
    static #translateKey(rawKey) {
        if (!rawKey.startsWith("system.")) return rawKey;

        const translatedKey = SystemMapper.translate(rawKey);
        return translatedKey === rawKey ? rawKey : `${translatedKey} (${rawKey})`;
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

            // Apply categorical grouping if the view mode is active
            if (this.#viewMode === "categorical") {
                player.characters.forEach((char) => {
                    char.categories = this.#buildCategoricalView(char.logs);
                });
            }
        });

        return {
            players: contextArray,
            isCategorical: this.#viewMode === "categorical",
        };
    }

    /**
     * Sorts a flat array of character logs into categorical buckets and groups by entity.
     * @param {Array<object>} logs - The chronological log array.
     * @returns {object} - The grouped categorical structure including action counts.
     */
    #buildCategoricalView(logs) {
        const buckets = { core: new Map(), items: new Map(), effects: new Map() };
        const counts = { core: 0, items: 0, effects: 0 };

        logs.forEach((log) => {
            for (const placement of AuditLogApp.#resolvePlacements(log)) {
                // Increment the total action count for this specific category
                counts[placement.bucket]++;

                const targetMap = buckets[placement.bucket];
                if (!targetMap.has(placement.groupKey)) {
                    targetMap.set(placement.groupKey, { name: placement.name, logs: [] });
                }
                targetMap.get(placement.groupKey).logs.push(placement.log);
            }
        });

        // Return flat, alphabetically sorted arrays and their respective total action counts
        const sortByName = (a, b) => a.name.localeCompare(b.name);
        return {
            core: Array.from(buckets.core.values()).sort(sortByName),
            coreCount: counts.core,
            items: Array.from(buckets.items.values()).sort(sortByName),
            itemsCount: counts.items,
            effects: Array.from(buckets.effects.values()).sort(sortByName),
            effectsCount: counts.effects,
        };
    }

    /**
     * Works out which bucket and entity group(s) a log belongs to.
     * @param {object} log - A translated display log.
     * @returns {Array<{bucket: string, groupKey: string, name: string, log: object}>}
     */
    static #resolvePlacements(log) {
        if (log.action === "Data Modified") return AuditLogApp.#resolveCorePlacements(log);
        if (log.action.includes("Item")) return [AuditLogApp.#buildPlacement("items", log, AuditLogApp.#resolveItemName(log))];
        if (log.action.includes("Effect")) return [AuditLogApp.#buildPlacement("effects", log, AuditLogApp.#resolveEffectName(log))];

        return [];
    }

    /**
     * Splits a core data log into one placement per changed key.
     * A single update can change several stats at once; filing the whole entry under only the
     * first stat would hide the other changes from those stats' histories. Each placement gets
     * a copy of the log whose detail holds only its own change.
     * @param {object} log - A translated "Data Modified" display log (with detailParts).
     * @returns {Array<object>}
     */
    static #resolveCorePlacements(log) {
        return log.detailParts.map((part) => ({
            bucket: "core",
            groupKey: part.name,
            name: part.name,
            log: { ...log, detail: part.text },
        }));
    }

    /**
     * Builds a placement for an item or effect log.
     * Uses the saved entity ID to prevent identical name collisions, falling back to the name
     * for v1.0.0 legacy logs that have no ID.
     */
    static #buildPlacement(bucket, log, name) {
        return { bucket, groupKey: log.entityId || name, name, log };
    }

    /**
     * Derives the display name of the item an item log refers to.
     */
    static #resolveItemName(log) {
        if (log.action === "Item Modified") return log.detail.split(CHANGE_SEPARATOR)[0];

        const parts = log.detail.split(VALUE_ARROW);
        return parts.length === 2 ? `${parts[0]} (${parts[1]})` : log.detail;
    }

    /**
     * Derives the display name of the effect an effect log refers to.
     */
    static #resolveEffectName(log) {
        if (log.action === "Active Effect Modified") return log.detail.split(CHANGE_SEPARATOR)[0];

        return `Effect (${log.detail})`;
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

    /**
     * Action handler: Toggles between chronological and categorical views.
     * @this {AuditLogApp}
     */
    static async #handleToggleView(event, target) {
        this.#viewMode = this.#viewMode === "chronological" ? "categorical" : "chronological";
        await this.render({ force: false });
    }
}
