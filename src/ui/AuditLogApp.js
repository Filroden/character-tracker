/**
 * The ApplicationV2 interface for reviewing character audit logs.
 */

import { StateManager } from "../data/StateManager.js";
import { exportPlayerLogs } from "../utils/exportHelpers.js";
import { ACCENTS, MODULE_ID, SETTING_KEYS, getAccent } from "../config/settings.js";
import { SystemMapper } from "../systems/SystemMapper.js";
import { CHANGE_SEPARATOR, VALUE_ARROW, defaultChangeLabel, formatChange } from "../utils/logFormatting.js";
import { REVERSION_KINDS, findReversions } from "../utils/revertDetection.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Units used to describe how long a reverted change lasted, largest first. The first unit the
 * duration reaches is used, so 90 minutes reads as "2 hr" rather than "90 min".
 */
const DURATION_UNITS = [
    { size: MS_PER_DAY, key: "character-tracker.ui.durationDays" },
    { size: MS_PER_HOUR, key: "character-tracker.ui.durationHours" },
    { size: MS_PER_MINUTE, key: "character-tracker.ui.durationMinutes" },
];

const LOG_ENTRY_PARTIAL = "modules/character-tracker/templates/log-entry.hbs";

const VIEW_MODES = {
    CHRONOLOGICAL: "chronological",
    CATEGORICAL: "categorical",
};

/** The class prefix that carries the accent hue (see character-tracker-theme.css). */
const ACCENT_CLASS_PREFIX = "character-tracker-accent--";

/** The options of the Appearance menu, in the order they are listed. */
const ACCENT_OPTIONS = [
    { id: ACCENTS.GOLD, label: "character-tracker.ui.accentGold" },
    { id: ACCENTS.BLUE, label: "character-tracker.ui.accentBlue" },
];

/**
 * The categorical view's buckets, in display order. The keys match the `bucket` values produced by
 * #resolvePlacements and #formatSummary.
 */
const CATEGORY_BUCKETS = [
    { key: "core", title: "character-tracker.ui.catCore" },
    { key: "items", title: "character-tracker.ui.catItems" },
    { key: "effects", title: "character-tracker.ui.catEffects" },
];

/**
 * Localisation keys for the stored action names. Actions are stored in English (they are also
 * written to exports and used to recognise entry types), so they are only translated for display.
 * An action missing from this map is shown as stored.
 */
const ACTION_LABEL_KEYS = {
    "Data Modified": "character-tracker.action.dataModified",
    "Item Added": "character-tracker.action.itemAdded",
    "Item Modified": "character-tracker.action.itemModified",
    "Item Removed": "character-tracker.action.itemRemoved",
    "Active Effect Added": "character-tracker.action.effectAdded",
    "Active Effect Modified": "character-tracker.action.effectModified",
    "Active Effect Removed": "character-tracker.action.effectRemoved",
};

const SELECTORS = {
    APPEARANCE: ".character-tracker-appearance",
    APPEARANCE_BUTTON: ".character-tracker-appearance__button",
    APPEARANCE_MENU: ".character-tracker-appearance__menu",
    SECTION: "details[data-section-key]",
};

export class AuditLogApp extends HandlebarsApplicationMixin(ApplicationV2) {
    #viewMode = VIEW_MODES.CHRONOLOGICAL;

    /**
     * When false (the default), changes a player made and later undid are folded into one summary
     * line each. When true, every original entry is shown, with the reverted ones faded.
     */
    #showReverted = false;

    /**
     * The user whose log is shown. Null until the first render, when #resolveSelectedUserId picks a
     * default. Kept for the life of the window, so refreshing or switching views keeps the same player.
     */
    #selectedUserId = null;

    /**
     * Open or closed state of every character card and entity group the GM has toggled, keyed by
     * data-section-key. A re-render rebuilds the DOM, which would otherwise reset every <details>
     * to its default; this map lets the GM's choices survive refreshes and view switches. Sections
     * the GM has never toggled take their default (see #isSectionOpen).
     * @type {Map<string, boolean>}
     */
    #sectionStates = new Map();

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
            height: 600,
        },
        actions: {
            clearAll: AuditLogApp.#handleClearAll,
            clearPlayer: AuditLogApp.#handleClearPlayer,
            exportPlayer: AuditLogApp.#handleExportPlayer,
            selectPlayer: AuditLogApp.#handleSelectPlayer,
            refreshLog: AuditLogApp.#handleRefreshLog,
            setView: AuditLogApp.#handleSetView,
            toggleReverted: AuditLogApp.#handleToggleReverted,
            toggleAppearance: AuditLogApp.#handleToggleAppearance,
            setAccent: AuditLogApp.#handleSetAccent,
        },
    };

    static PARTS = {
        main: {
            template: "modules/character-tracker/templates/audit-log.hbs",
            // Loaded and registered as a partial, because every view renders log entries the same way
            templates: [LOG_ENTRY_PARTIAL],
        },
    };

    /**
     * Prepares the data supplied to the Handlebars template.
     */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const accent = getAccent();

        const players = this.#buildPlayerContext();
        const selected = this.#resolveSelectedUserId(players);
        const currentPlayer = players.find((player) => player.id === selected) ?? null;
        if (currentPlayer) this.#formatPlayerLogs(currentPlayer);

        context.players = players.map((player) => AuditLogApp.#summarisePlayer(player, selected));
        context.currentPlayer = currentPlayer;
        context.hasAnyLogs = players.some((player) => player.stats.totalChanges > 0);
        context.isCategorical = this.#viewMode === VIEW_MODES.CATEGORICAL;
        context.showReverted = this.#showReverted;
        context.accent = accent;
        context.accents = ACCENT_OPTIONS.map((option) => ({ ...option, isActive: option.id === accent }));
        // Foundry's tooltip sits outside the window, so it needs the accent class to find the tokens
        context.tooltipClass = `character-tracker-tooltip ${ACCENT_CLASS_PREFIX}${accent}`;

        return context;
    }

    /**
     * Closes the Appearance menu on a press anywhere outside it. Bound once so the same function
     * can be removed from the document when the window closes.
     * @type {(event: PointerEvent) => void}
     */
    #outsidePressListener = (event) => this.#onPointerDown(event);

    /**
     * Hook that fires once, the first time the window is rendered. The root element survives later
     * renders (only its contents are replaced), so listeners attached here are never duplicated.
     * The press listener goes on the document, because a press outside the window must close the
     * menu too.
     */
    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        document.addEventListener("pointerdown", this.#outsidePressListener, { capture: true });
        this.element.addEventListener("keydown", (event) => this.#onKeyDown(event));
    }

    /**
     * Hook that fires when the window closes. Removes the document-level listener, which would
     * otherwise outlive the window.
     */
    _onClose(options) {
        super._onClose(options);
        document.removeEventListener("pointerdown", this.#outsidePressListener, { capture: true });
    }

    /**
     * Hook that fires after every render. Applies root-level classes and starts recording the open
     * state of the rendered sections.
     */
    _onRender(context, options) {
        super._onRender(context, options);
        AuditLogApp.#applyRTLSupport(this.element);
        AuditLogApp.#applyAccentClass(this.element, context.accent);
        this.#watchSections();
    }

    /**
     * Puts the accent class on the window itself, replacing any previous one. The tokens are set
     * on the window (not only on the template's root) so that the window's content area, which
     * Foundry owns, can use them for its background.
     * @param {HTMLElement} element - The root application element.
     * @param {string} accent - One of ACCENTS.
     */
    static #applyAccentClass(element, accent) {
        for (const option of ACCENT_OPTIONS) element.classList.remove(`${ACCENT_CLASS_PREFIX}${option.id}`);
        element.classList.add(`${ACCENT_CLASS_PREFIX}${accent}`);
    }

    /**
     * Records each character card's and entity group's open state whenever the GM opens or closes
     * it, so the next render can restore it. The listeners belong to elements that a re-render
     * replaces, so they are added again after every render and are never duplicated.
     */
    #watchSections() {
        for (const section of this.element.querySelectorAll(SELECTORS.SECTION)) {
            section.addEventListener("toggle", () => this.#sectionStates.set(section.dataset.sectionKey, section.open));
        }
    }

    /**
     * Returns whether a section should render open: the GM's last choice for it, or its default if
     * they have never toggled it.
     * @param {string} key - The section's data-section-key.
     * @param {boolean} fallback - The default state.
     * @returns {boolean}
     */
    #isSectionOpen(key, fallback) {
        return this.#sectionStates.get(key) ?? fallback;
    }

    /**
     * Works out whose log to show. Keeps the current choice while that user is still listed;
     * otherwise picks the first player with logged changes, or the first player if nobody has any.
     * @param {Array<object>} players - The players from #buildPlayerContext.
     * @returns {string|null} - The selected user ID, or null when no players are listed.
     */
    #resolveSelectedUserId(players) {
        const stillListed = players.some((player) => player.id === this.#selectedUserId);
        if (!stillListed) {
            const fallback = players.find((player) => player.stats.totalChanges > 0) ?? players[0];
            this.#selectedUserId = fallback?.id ?? null;
        }
        return this.#selectedUserId;
    }

    /**
     * Reduces a player to what the player list shows.
     * @param {object} player - A player from #buildPlayerContext.
     * @param {string|null} selectedId - The selected user ID.
     * @returns {{id: string, name: string, isGM: boolean, totalChanges: number, isSelected: boolean}}
     */
    static #summarisePlayer(player, selectedId) {
        return {
            id: player.id,
            name: player.name,
            isGM: player.isGM,
            totalChanges: player.stats.totalChanges,
            isSelected: player.id === selectedId,
        };
    }

    /**
     * Builds the one-line summary under the selected player's name, for example
     * "24 changes · last 9m 37s ago", or a note that nothing has been recorded.
     * @param {object} stats - The player's statistics.
     * @returns {string}
     */
    static #formatStats(stats) {
        if (stats.totalChanges === 0) return game.i18n.localize("character-tracker.ui.statsNone");

        const countKey = stats.totalChanges === 1 ? "character-tracker.ui.statsChangesOne" : "character-tracker.ui.statsChanges";
        const count = game.i18n.format(countKey, { count: stats.totalChanges });
        const last = game.i18n.format("character-tracker.ui.statsLast", { time: foundry.utils.timeSince(stats.lastActivity) });
        return `${count} · ${last}`;
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
     * Every player's statistics are counted (the player list shows them all), but each player's
     * characters stay as raw maps until #formatPlayerLogs prepares the one being shown.
     * @returns {Array<object>}
     */
    #buildPlayerContext() {
        const logs = StateManager.getLogs();
        const playersMap = this.#initializePlayersMap();

        // Reversals are found across the whole log, because another player's change to a field
        // means that field's history can no longer be folded for anyone
        const reversions = findReversions(logs);

        logs.forEach((log) => this.#aggregateLog(playersMap, log, reversions));

        return Array.from(playersMap.values());
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
                    name: user.name,
                    // Shown as a GM tag beside the name, so the name itself stays the user's own
                    isGM: user.isGM,
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
    #aggregateLog(playersMap, log, reversions) {
        const player = playersMap.get(log.userId);
        if (!player) return;

        const displayLog = this.#translateLog(log, reversions);

        this.#updatePlayerStats(player.stats, displayLog);
        this.#assignLogToCharacter(player.charactersMap, displayLog);
    }

    /**
     * Safely translates system keys for UI presentation without mutating the database object.
     * For core data changes it also attaches `detailParts` (one { name, text, reverted } entry per
     * changed key), which the categorical view uses to file each change under its own stat, and
     * which the chronological view uses to fade the individual changes that were later undone.
     * Every entry also carries its reversal state (`isReverted`) and the summary lines that belong
     * at its point in time (`revertSummaries`, see findReversions).
     * @param {object} log - The stored log entry.
     * @param {object} reversions - The result of findReversions for the whole log.
     * @returns {object} - The display copy of the entry.
     */
    #translateLog(log, reversions) {
        const displayLog = {
            ...log,
            actionLabel: AuditLogApp.#labelForAction(log.action),
            isReverted: reversions.revertedLogs.has(log),
            revertSummaries: (reversions.summaries.get(log) ?? []).map((summary) => AuditLogApp.#formatSummary(summary)),
        };

        if (displayLog.action !== "Data Modified") return displayLog;

        // Entries recorded before structured changes existed only carry the joined detail string
        const revertedKeys = reversions.revertedKeys.get(log) ?? new Set();
        displayLog.detailParts = Array.isArray(log.changes) ? AuditLogApp.#partsFromChanges(log.changes, revertedKeys) : AuditLogApp.#partsFromLegacyDetail(log.detail);

        displayLog.detail = displayLog.detailParts.map((part) => part.text).join(CHANGE_SEPARATOR);

        // Only an entry that is partly reverted needs its parts styled one by one
        displayLog.hasRevertedParts = !displayLog.isReverted && displayLog.detailParts.some((part) => part.reverted);

        return displayLog;
    }

    /**
     * Builds display parts from structured change records.
     * @param {Array<object>} changes - The change records stored on the log entry.
     * @param {Set<string>} revertedKeys - The keys in this entry that were later undone.
     * @returns {Array<{name: string, text: string, reverted: boolean}>}
     */
    static #partsFromChanges(changes, revertedKeys) {
        return changes.map((change) => {
            const label = AuditLogApp.#labelForKey(change.key);
            return {
                name: label,
                text: formatChange(change, label),
                label,
                value: AuditLogApp.#formatChangeValue(change),
                reverted: revertedKeys.has(change.key),
            };
        });
    }

    /**
     * Formats the value half of a change record for display beside its label, in the readout face:
     * "50 ➔ 55", or "➔ 55" when no previous value was captured. Summary-only records (such as token
     * settings) have no value and return an empty string, so only their label is shown.
     * @param {object} change - A structured change record.
     * @returns {string}
     */
    static #formatChangeValue(change) {
        if (!("to" in change)) return "";
        if (!("from" in change)) return `${VALUE_ARROW.trimStart()}${change.to}`;

        return `${change.from}${VALUE_ARROW}${change.to}`;
    }

    /**
     * Returns the display label for a stored action name (see ACTION_LABEL_KEYS).
     * @param {string} action - The stored action, such as "Item Added".
     * @returns {string}
     */
    static #labelForAction(action) {
        const key = ACTION_LABEL_KEYS[action];
        return key ? game.i18n.localize(key) : action;
    }

    /**
     * Returns the display label for a change key: the translated label for system keys, otherwise the
     * fixed label for special keys (such as "Name").
     * @param {string} key - The flattened key.
     * @returns {string}
     */
    static #labelForKey(key) {
        return key.startsWith("system.") ? AuditLogApp.#translateKey(key) : defaultChangeLabel({ key });
    }

    /**
     * Turns a reversal summary into a display entry. Summary entries carry `isRevertSummary` for the
     * template, plus the bucket and group they belong to in the categorical view, so they are filed
     * beside the entries they replace.
     * @param {object} summary - A summary record from findReversions.
     * @returns {object} - The display entry.
     */
    static #formatSummary(summary) {
        const duration = AuditLogApp.#formatDuration(summary.end - summary.start);
        const actionLabel = game.i18n.localize("character-tracker.ui.revertedAction");
        const base = {
            isRevertSummary: true,
            timestamp: summary.end,
            action: actionLabel,
            actionLabel,
            recordedWithoutGM: summary.recordedWithoutGM,
        };

        if (summary.kind === REVERSION_KINDS.ENTITY) return { ...base, ...AuditLogApp.#describeEntitySummary(summary.closingLog, duration) };

        const label = AuditLogApp.#labelForKey(summary.key);
        return {
            ...base,
            bucket: "core",
            groupKey: label,
            groupName: label,
            detail: game.i18n.format("character-tracker.ui.revertedData", { label, value: summary.value, duration }),
        };
    }

    /**
     * Builds the parts of an item or effect summary that depend on which of the two it is.
     * @param {object} removedLog - The "Removed" entry that completed the reversal.
     * @param {string} duration - The formatted time between adding and removing it.
     * @returns {{bucket: string, groupKey: string, groupName: string, detail: string}}
     */
    static #describeEntitySummary(removedLog, duration) {
        const isItem = removedLog.action === "Item Removed";
        const name = isItem ? AuditLogApp.#resolveItemName(removedLog) : AuditLogApp.#resolveEffectName(removedLog);

        return {
            bucket: isItem ? "items" : "effects",
            groupKey: removedLog.entityId,
            groupName: name,
            detail: game.i18n.format("character-tracker.ui.revertedEntity", { name, duration }),
        };
    }

    /**
     * Formats a length of time in its largest whole unit, rounded (for example "4 min").
     * Anything under a minute is shown in seconds, and never as zero.
     * @param {number} ms - The duration in milliseconds.
     * @returns {string}
     */
    static #formatDuration(ms) {
        const unit = DURATION_UNITS.find((candidate) => ms >= candidate.size);
        if (unit) return game.i18n.format(unit.key, { count: Math.round(ms / unit.size) });

        return game.i18n.format("character-tracker.ui.durationSeconds", { count: Math.max(1, Math.round(ms / MS_PER_SECOND)) });
    }

    /**
     * Builds display parts by parsing a legacy "key ➔ value | key ➔ value" detail string.
     * @param {string} detail - The stored detail string.
     * @returns {Array<{name: string, text: string, label: string, value: string}>}
     */
    static #partsFromLegacyDetail(detail) {
        return detail.split(CHANGE_SEPARATOR).map((part) => {
            const [rawKey, val] = part.split(VALUE_ARROW);

            // Parts without an arrow (such as "Token Settings Modified") are their own label
            if (val === undefined) return { name: part, text: part, label: part, value: "" };

            const label = AuditLogApp.#translateKey(rawKey);
            return { name: label, text: `${label}${VALUE_ARROW}${val}`, label, value: `${VALUE_ARROW.trimStart()}${val}` };
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
     * Prepares the selected player's characters for the template: applies the reverted-changes
     * setting, orders each character's entries newest first, groups them for the categorical view
     * when it is active, and restores each card's open state. The first character starts open, so
     * the log is never an empty column of closed cards.
     * @param {object} player - A player from #buildPlayerContext (changed in place).
     */
    #formatPlayerLogs(player) {
        const isCategorical = this.#viewMode === VIEW_MODES.CATEGORICAL;

        player.statsText = AuditLogApp.#formatStats(player.stats);
        player.characters = Array.from(player.charactersMap.values()).map((char, index) => {
            const key = `${player.id}:${char.name}`;
            const logs = [...this.#arrangeLogs(char.logs)].reverse();
            return {
                key,
                name: char.name,
                logs,
                count: logs.length,
                open: this.#isSectionOpen(key, index === 0),
                groups: isCategorical ? this.#buildCategoricalView(logs, key) : [],
            };
        });
        delete player.charactersMap;
    }

    /**
     * Applies the reverted-changes setting to a character's entries.
     * Folded (the default): fully reverted entries are dropped, and each reversal's summary line is
     * placed straight after the entry that completed it, which is also where it falls in time. The
     * summaries are added even when that entry was itself dropped (such as the removal of an item).
     * Expanded: every entry is kept as it is, and the template fades the reverted ones.
     * @param {Array<object>} logs - The character's display entries, oldest first.
     * @returns {Array<object>} - The entries to show.
     */
    #arrangeLogs(logs) {
        if (this.#showReverted) return logs;

        return logs.flatMap((log) => [...(log.isReverted ? [] : [log]), ...log.revertSummaries]);
    }

    /**
     * Sorts a character's entries into the categorical view's buckets, and each bucket into one
     * group per entity (stat, item or effect).
     * @param {Array<object>} logs - The character's display entries, in display order.
     * @param {string} charKey - The character card's section key, used to key its entity groups.
     * @returns {Array<object>} - One entry per non-empty bucket, in CATEGORY_BUCKETS order, each
     *          with its title key, its change count and its entities sorted by name.
     */
    #buildCategoricalView(logs, charKey) {
        const buckets = new Map(CATEGORY_BUCKETS.map((bucket) => [bucket.key, new Map()]));

        for (const log of logs) {
            for (const placement of AuditLogApp.#resolvePlacements(log, this.#showReverted)) {
                AuditLogApp.#addToGroup(buckets.get(placement.bucket), placement);
            }
        }

        return CATEGORY_BUCKETS.map((bucket) => this.#formatBucket(bucket, buckets.get(bucket.key), charKey)).filter((bucket) => bucket.count > 0);
    }

    /**
     * Files one placement under its entity group, creating the group on first use.
     * @param {Map<string, {name: string, logs: Array<object>}>} groups - One bucket's groups.
     * @param {{groupKey: string, name: string, log: object}} placement - From #resolvePlacements.
     */
    static #addToGroup(groups, placement) {
        if (!groups.has(placement.groupKey)) groups.set(placement.groupKey, { groupKey: placement.groupKey, name: placement.name, logs: [] });
        groups.get(placement.groupKey).logs.push(placement.log);
    }

    /**
     * Turns one bucket's groups into template data. An entity with a single change is flagged
     * `isSingle`, so the template shows that change directly instead of behind a click. Entity
     * groups start closed.
     * @param {{key: string, title: string}} bucket - The bucket's entry in CATEGORY_BUCKETS.
     * @param {Map<string, object>} groups - The bucket's groups.
     * @param {string} charKey - The character card's section key.
     * @returns {{key: string, title: string, count: number, entities: Array<object>}}
     */
    #formatBucket(bucket, groups, charKey) {
        const entities = Array.from(groups.values())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((group) => {
                const key = `${charKey}:${bucket.key}:${group.groupKey}`;
                return { key, name: group.name, logs: group.logs, count: group.logs.length, isSingle: group.logs.length === 1, open: this.#isSectionOpen(key, false) };
            });

        return { key: bucket.key, title: bucket.title, count: entities.reduce((total, entity) => total + entity.count, 0), entities };
    }

    /**
     * Works out which bucket and entity group(s) a log belongs to.
     * Summary lines already know their bucket and group (see #formatSummary).
     * @param {object} log - A translated display log.
     * @param {boolean} showReverted - Whether reverted changes are being shown in full.
     * @returns {Array<{bucket: string, groupKey: string, name: string, log: object}>}
     */
    static #resolvePlacements(log, showReverted) {
        if (log.isRevertSummary) return [{ bucket: log.bucket, groupKey: log.groupKey, name: log.groupName, log }];
        if (log.action === "Data Modified") return AuditLogApp.#resolveCorePlacements(log, showReverted);
        if (log.action.includes("Item")) return [AuditLogApp.#buildPlacement("items", log, AuditLogApp.#resolveItemName(log))];
        if (log.action.includes("Effect")) return [AuditLogApp.#buildPlacement("effects", log, AuditLogApp.#resolveEffectName(log))];

        return [];
    }

    /**
     * Splits a core data log into one placement per changed key.
     * A single update can change several stats at once; filing the whole entry under only the
     * first stat would hide the other changes from those stats' histories. Each placement gets
     * a copy of the log whose detail holds only its own change.
     * When reverted changes are folded, a reverted part is left out here, because that stat's group
     * receives the summary line instead. Otherwise the part is kept and marked as reverted.
     * @param {object} log - A translated "Data Modified" display log (with detailParts).
     * @param {boolean} showReverted - Whether reverted changes are being shown in full.
     * @returns {Array<object>}
     */
    static #resolveCorePlacements(log, showReverted) {
        return log.detailParts
            .filter((part) => showReverted || !part.reverted)
            .map((part) => ({
                bucket: "core",
                groupKey: part.name,
                name: part.name,
                // The copy lists only its own change, so the stat's history shows nothing from the others
                log: { ...log, detail: part.text, detailParts: [part], isReverted: part.reverted, hasRevertedParts: false },
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
     * Asks the GM to confirm a deletion. The confirming button names the action (never "Yes"),
     * and Cancel is the default button, so pressing Enter alone never deletes anything.
     * @param {object} text - Localised strings for the dialogue.
     * @param {string} text.title - The dialogue's title.
     * @param {string} text.body - What will be deleted.
     * @param {string} text.action - The confirming button's label.
     * @returns {Promise<boolean>} - True only if the GM confirmed.
     */
    static async #confirmDeletion({ title, body, action }) {
        const confirmed = await DialogV2.confirm({
            classes: ["character-tracker-dialog", `${ACCENT_CLASS_PREFIX}${getAccent()}`],
            window: { title },
            content: `<p>${body}</p><p>${game.i18n.localize("character-tracker.ui.exportFirst")}</p>`,
            yes: { label: action, default: false },
            no: { label: game.i18n.localize("character-tracker.ui.cancel"), default: true },
            modal: true,
            rejectClose: false,
        });
        return confirmed === true;
    }

    /**
     * Action handler: Prompts the user before globally clearing all logs.
     */
    static async #handleClearAll(event, target) {
        const count = StateManager.getLogs().length;
        const confirmed = await AuditLogApp.#confirmDeletion({
            title: game.i18n.localize("character-tracker.ui.clearAllTitle"),
            body: game.i18n.format("character-tracker.ui.clearAllConfirm", { count }),
            action: game.i18n.localize("character-tracker.ui.deleteAll"),
        });
        if (!confirmed) return;

        await StateManager.clearLogs();
        await this.render({ force: false });
    }

    /**
     * Action handler: Wipes the logs for a specific player, after confirmation.
     */
    static async #handleClearPlayer(event, target) {
        const userId = target.dataset.userId;
        const user = game.users.get(userId);
        if (!user) return;

        const name = user.name;
        const count = StateManager.getLogs(userId).length;
        const confirmed = await AuditLogApp.#confirmDeletion({
            title: game.i18n.format("character-tracker.ui.clearPlayerTitle", { name }),
            body: game.i18n.format("character-tracker.ui.clearPlayerConfirm", { name, count }),
            action: game.i18n.format("character-tracker.ui.deletePlayer", { name }),
        });
        if (!confirmed) return;

        await StateManager.clearLogs(userId);
        await this.render({ force: false });
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
     * Action handler: Shows the chosen player's log.
     * @this {AuditLogApp}
     */
    static async #handleSelectPlayer(event, target) {
        const userId = target.dataset.userId;
        if (!userId || userId === this.#selectedUserId) return;

        this.#selectedUserId = userId;
        await this.render({ force: false });
    }

    /**
     * Action handler: Manually recalculates state and refreshes the application UI.
     */
    static async #handleRefreshLog(event, target) {
        await this.render({ force: false });
    }

    /**
     * Action handler: Switches between the timeline (chronological) and categorical views.
     * @this {AuditLogApp}
     */
    static async #handleSetView(event, target) {
        const view = target.dataset.view;
        if (!Object.values(VIEW_MODES).includes(view) || view === this.#viewMode) return;

        this.#viewMode = view;
        await this.render({ force: false });
    }

    /**
     * Action handler: Switches between folding reverted changes and expanding them in full.
     * @this {AuditLogApp}
     */
    static async #handleToggleReverted(event, target) {
        this.#showReverted = !this.#showReverted;
        await this.render({ force: false });
    }

    /**
     * Action handler: Opens or closes the Appearance menu. The menu is shown and hidden in place
     * rather than by re-rendering, so opening it costs nothing and keeps the log's scroll position.
     * @this {AuditLogApp}
     */
    static #handleToggleAppearance(event, target) {
        const menu = this.element.querySelector(SELECTORS.APPEARANCE_MENU);
        this.#setAppearanceOpen(menu?.hidden ?? false);
    }

    /**
     * Action handler: Saves the chosen accent hue (a client setting, so each user keeps their own)
     * and re-renders with it.
     * @this {AuditLogApp}
     */
    static async #handleSetAccent(event, target) {
        const accent = target.dataset.accent;
        if (!Object.values(ACCENTS).includes(accent)) return;

        if (accent !== getAccent()) await game.settings.set(MODULE_ID, SETTING_KEYS.ACCENT, accent);
        await this.render({ force: false });
    }

    /**
     * Shows or hides the Appearance menu and keeps its button's aria-expanded in step. On opening,
     * focus moves to the menu's checked item so the keyboard lands inside the menu.
     * @param {boolean} open - Whether the menu should be open.
     * @param {object} [options]
     * @param {boolean} [options.returnFocus=false] - On closing, move focus back to the button.
     */
    #setAppearanceOpen(open, { returnFocus = false } = {}) {
        const menu = this.element.querySelector(SELECTORS.APPEARANCE_MENU);
        const button = this.element.querySelector(SELECTORS.APPEARANCE_BUTTON);
        if (!menu || !button) return;

        menu.hidden = !open;
        button.setAttribute("aria-expanded", String(open));

        if (open) menu.querySelector('[aria-checked="true"]')?.focus();
        else if (returnFocus) button.focus();
    }

    /**
     * Closes the Appearance menu when the GM presses anywhere outside it.
     * @param {PointerEvent} event
     */
    #onPointerDown(event) {
        if (!this.element || event.target.closest?.(SELECTORS.APPEARANCE)) return;
        this.#setAppearanceOpen(false);
    }

    /**
     * Closes the Appearance menu on Escape, returning focus to its button. Escape is stopped here
     * only while the menu is open, so it does not also close the whole window.
     * @param {KeyboardEvent} event
     */
    #onKeyDown(event) {
        if (event.key !== "Escape") return;

        const menu = this.element.querySelector(SELECTORS.APPEARANCE_MENU);
        if (!menu || menu.hidden) return;

        event.stopPropagation();
        this.#setAppearanceOpen(false, { returnFocus: true });
    }
}
