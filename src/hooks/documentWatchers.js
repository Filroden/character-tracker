/**
 * Intercepts core document events to build the audit log.
 */

import { StateManager } from "../data/StateManager.js";
import { MODULE_ID, SETTING_KEYS } from "../config/settings.js";
import { SystemMapper } from "../systems/SystemMapper.js";
import { CHANGE_KEYS, CHANGE_SEPARATOR, formatChange } from "../utils/logFormatting.js";

/**
 * Shown when a field had no value before it was changed (for example, a newly added key).
 */
const EMPTY_VALUE = "—";

/**
 * Registers the required document hooks.
 * Executed during the Foundry 'ready' phase.
 */
export function registerDocumentWatchers() {
    Hooks.on("preUpdateItem", handleEmbeddedPreUpdate);
    Hooks.on("preUpdateActiveEffect", handleEmbeddedPreUpdate);
    Hooks.on("preUpdateActor", handleActorPreUpdate);
    Hooks.on("createItem", handleItemCreation);
    Hooks.on("updateItem", handleItemUpdate);
    Hooks.on("deleteItem", handleItemDeletion);
    Hooks.on("createActiveEffect", handleEffectCreation);
    Hooks.on("updateActiveEffect", handleEffectUpdate);
    Hooks.on("deleteActiveEffect", handleEffectDeletion);
    Hooks.on("updateActor", handleActorUpdate);
}

/**
 * Validates if the current client should process this event based on user permissions.
 * @param {string} actionAuthorId - The ID of the user who triggered the event.
 * @returns {boolean} - True if this client should process the log.
 */
function shouldProcessLog(actionAuthorId) {
    // 1. THE BROWSER GUARD: Only the GM's browser should process logs to prevent duplicates
    const currentBrowserUserId = game.user.id;
    if (game.users.activeGM?.id !== currentBrowserUserId) return false;

    // 2. THE AUTHOR GUARD: Check who actually made the change
    const actionAuthor = game.users.get(actionAuthorId);
    if (!actionAuthor) return false;

    // If the person who made the change is a GM, check the module settings
    if (actionAuthor.isGM) {
        const trackGMs = game.settings.get(MODULE_ID, SETTING_KEYS.TRACK_GM);
        if (!trackGMs) return false; // Ignore the GM's action if the setting is off
    }

    // If we reach this point, it was either a Player action, or a GM action with tracking enabled
    return true;
}

/* ===================================================================
   --- PREVIOUS VALUE CAPTURE ---
=================================================================== */

/**
 * Captures the pre-update values of an embedded Item or Active Effect.
 * Only documents embedded directly on a world Actor are tracked, matching the update watchers.
 */
function handleEmbeddedPreUpdate(document, changes, options, _userId) {
    if (document.parent?.documentName !== "Actor") return;
    if (document.parent.isToken) return;

    capturePreviousValues(document, changes, options);
}

/**
 * Captures the pre-update values of a player-owned world Actor.
 */
function handleActorPreUpdate(actor, changes, options, _userId) {
    if (actor.isToken) return;
    if (!actor.hasPlayerOwner) return;

    capturePreviousValues(actor, changes, options);
}

/**
 * Records the current (soon to be previous) value of every tracked key in the pending update.
 *
 * Why the options object: preUpdate hooks only fire on the client that requested the update,
 * while the log is written by a different client (normally the active GM) in the matching
 * update hook. Foundry sends the update's options to the server and broadcasts them to every
 * client with the result, so anything stored on them here arrives in that later hook's options.
 * Everything stored must therefore stay JSON-serialisable.
 *
 * Why keyed by document ID: a batch update (updateEmbeddedDocuments) shares a single options
 * object across every document in the operation, so values must be namespaced per document
 * or one item's previous values would overwrite another's.
 *
 * Why `_source`: the update diff is computed against the stored source data. Reading the
 * prepared document instead could return derived values (such as totals that include bonuses)
 * that were never in the database.
 *
 * @param {foundry.abstract.Document} document - The document about to be updated.
 * @param {object} changes - The pending update data.
 * @param {object} options - The update options that travel with the operation.
 */
function capturePreviousValues(document, changes, options) {
    const previous = {};

    for (const key of getTrackedKeys(changes)) {
        previous[key] = formatDisplayValue(foundry.utils.getProperty(document._source, key));
    }

    if (Object.keys(previous).length === 0) return;

    options[MODULE_ID] ??= {};
    options[MODULE_ID].previous ??= {};
    options[MODULE_ID].previous[document.id] = previous;
}

/**
 * Retrieves the previous values captured for a document by capturePreviousValues.
 * @param {object} options - The update options received by the update hook.
 * @param {string} documentId - The ID of the updated document.
 * @returns {object} - A map of flattened key to formatted previous value (empty if none captured).
 */
function getCapturedValues(options, documentId) {
    return options?.[MODULE_ID]?.previous?.[documentId] ?? {};
}

/**
 * Lists the keys in an update that carry a single value worth showing as "was ➔ now".
 * Token settings are deliberately excluded because they are only ever summarised.
 * @param {object} update - The update data.
 * @returns {Array<string>} - The tracked flattened keys.
 */
function getTrackedKeys(update) {
    const keys = Object.keys(foundry.utils.flattenObject(update)).filter((key) => key.startsWith("system."));
    if (update.name) keys.unshift(CHANGE_KEYS.NAME);

    return keys;
}

/* ===================================================================
   --- ITEM WATCHERS ---
=================================================================== */

/**
 * Handles the creation of an embedded Item.
 */
function handleItemCreation(item, options, userId) {
    if (!shouldProcessLog(userId)) return;
    if (item.parent?.documentName !== "Actor") return;
    if (item.parent.isToken) return;

    const itemType = formatDocumentType(item.type);

    const logEntry = {
        userId: userId,
        actorName: item.parent.name,
        action: "Item Added",
        detail: `${itemType} ➔ ${item.name}`,
        entityId: item.id,
        timestamp: Date.now(),
    };

    StateManager.addLog(logEntry);
}

/**
 * Handles the modification of an existing embedded Item.
 */
function handleItemUpdate(item, update, options, userId) {
    if (!shouldProcessLog(userId)) return;
    if (item.parent?.documentName !== "Actor") return;
    if (item.parent.isToken) return;

    // Utilise the exact same flattening extraction logic used for actors
    const changes = extractUpdateChanges(update, getCapturedValues(options, item.id));
    if (changes.length === 0) return;

    const itemType = formatDocumentType(item.type);
    const itemContext = `${itemType} (${item.name})`;

    const logEntry = {
        userId: userId,
        actorName: item.parent.name,
        action: "Item Modified",
        detail: `${itemContext}${CHANGE_SEPARATOR}${formatChangeList(changes)}`,
        changes: changes,
        entityId: item.id,
        timestamp: Date.now(),
    };

    StateManager.addLog(logEntry);
}

/**
 * Handles the deletion of an embedded Item.
 */
function handleItemDeletion(item, options, userId) {
    if (!shouldProcessLog(userId)) return;
    if (item.parent?.documentName !== "Actor") return;
    if (item.parent.isToken) return;

    const itemType = formatDocumentType(item.type);

    const logEntry = {
        userId: userId,
        actorName: item.parent.name,
        action: "Item Removed",
        detail: `${itemType} ➔ ${item.name}`,
        entityId: item.id,
        timestamp: Date.now(),
    };

    StateManager.addLog(logEntry);
}

/* ===================================================================
   --- ACTIVE EFFECT WATCHERS ---
=================================================================== */

/**
 * Handles the creation of an embedded Active Effect.
 */
function handleEffectCreation(effect, options, userId) {
    if (!shouldProcessLog(userId)) return;
    if (effect.parent?.documentName !== "Actor") return;
    if (effect.parent.isToken) return;

    const logEntry = {
        userId: userId,
        actorName: effect.parent.name,
        action: "Active Effect Added",
        detail: effect.name,
        entityId: effect.id,
        timestamp: Date.now(),
    };

    StateManager.addLog(logEntry);
}

/**
 * Handles the modification or toggling of an existing Active Effect.
 */
function handleEffectUpdate(effect, update, options, userId) {
    if (!shouldProcessLog(userId)) return;
    if (effect.parent?.documentName !== "Actor") return;
    if (effect.parent.isToken) return;

    const changes = extractUpdateChanges(update, getCapturedValues(options, effect.id));
    if (changes.length === 0) return;

    const logEntry = {
        userId: userId,
        actorName: effect.parent.name,
        action: "Active Effect Modified",
        detail: `Effect (${effect.name})${CHANGE_SEPARATOR}${formatChangeList(changes)}`,
        changes: changes,
        entityId: effect.id,
        timestamp: Date.now(),
    };

    StateManager.addLog(logEntry);
}

/**
 * Handles the deletion of an embedded Active Effect.
 */
function handleEffectDeletion(effect, options, userId) {
    if (!shouldProcessLog(userId)) return;
    if (effect.parent?.documentName !== "Actor") return;
    if (effect.parent.isToken) return;

    const logEntry = {
        userId: userId,
        actorName: effect.parent.name,
        action: "Active Effect Removed",
        detail: effect.name,
        entityId: effect.id,
        timestamp: Date.now(),
    };

    StateManager.addLog(logEntry);
}

/* ===================================================================
   --- ACTOR WATCHERS ---
=================================================================== */

/**
 * Handles modifications to the Actor document.
 */
function handleActorUpdate(actor, update, options, userId) {
    if (!shouldProcessLog(userId)) return;
    if (actor.isToken) return;
    if (!actor.hasPlayerOwner) return;

    const changes = extractUpdateChanges(update, getCapturedValues(options, actor.id));
    if (changes.length === 0) return;

    const logEntry = {
        userId: userId,
        actorName: actor.name,
        action: "Data Modified",
        detail: formatChangeList(changes),
        changes: changes,
        timestamp: Date.now(),
    };

    StateManager.addLog(logEntry);
}

/**
 * Examines the update object and builds a structured change record for each tracked key.
 * The stored records are plain objects so the log stays JSON-serialisable (see logFormatting.js
 * for the record shape).
 * @param {object} update - The diff object provided by the hook.
 * @param {object} previous - Formatted previous values captured in the matching preUpdate hook.
 * @returns {Array<object>} - The structured change records, in display order.
 */
function extractUpdateChanges(update, previous) {
    const changes = [];

    // 1. Explicit top-level checks
    if (update.name) changes.push(buildValueChange(CHANGE_KEYS.NAME, previous[CHANGE_KEYS.NAME], update.name));

    // Token settings are a large nested object, so they are summarised rather than itemised
    if (update.prototypeToken) changes.push({ key: CHANGE_KEYS.TOKEN });

    // 2. Flatten the entire payload to safely catch BOTH nested and flat data structures
    const flatUpdate = foundry.utils.flattenObject(update);

    for (const [key, value] of Object.entries(flatUpdate)) {
        if (key.startsWith("system.")) changes.push(buildValueChange(key, previous[key], value));
    }

    return changes;
}

/**
 * Builds a single change record.
 * The `from` property is left out entirely when no previous value was captured, which keeps
 * "unknown" distinct from a genuine empty or null value.
 * @param {string} key - The flattened key.
 * @param {*} previousValue - The formatted previous value, or undefined if none was captured.
 * @param {*} newValue - The raw new value from the update.
 * @returns {object} - The change record.
 */
function buildValueChange(key, previousValue, newValue) {
    const change = { key };
    if (previousValue !== undefined) change.from = previousValue;
    change.to = formatDisplayValue(newValue);

    return change;
}

/**
 * Joins change records into the stored `detail` string used by the export and older views.
 * @param {Array<object>} changes - The change records.
 * @returns {string} - The formatted detail text.
 */
function formatChangeList(changes) {
    return changes.map((change) => formatChange(change)).join(CHANGE_SEPARATOR);
}

/**
 * Formats a raw database value into a safe, readable string for the UI.
 * @param {*} value - The raw value from the database delta.
 * @returns {string|number|boolean} - The formatted display value.
 */
function formatDisplayValue(value) {
    if (value === undefined) return EMPTY_VALUE;
    if (value === "") return '""';
    if (value === null) return "null";

    // Natively intercept arrays and flatten their contents
    if (Array.isArray(value)) return `[${value.join(", ")}]`;

    // Natively intercept empty objects used to clear data states
    if (typeof value === "object" && Object.keys(value).length === 0) return "{}";

    if (typeof value === "object") return "[Object]";

    return value;
}

/**
 * Formats a document type string for UI presentation by capitalising the first letter.
 * @param {string} type - The raw type string (e.g., "weapon").
 * @returns {string} - The capitalised string (e.g., "Weapon").
 */
function formatDocumentType(type) {
    if (!type) return "Item";
    return type.charAt(0).toUpperCase() + type.slice(1);
}
