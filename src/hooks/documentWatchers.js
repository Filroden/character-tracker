/**
 * Intercepts core document events to build the audit log.
 */

import { StateManager } from "../data/StateManager.js";
import { MODULE_ID, SETTING_KEYS } from "../config/settings.js";
import { SystemMapper } from "../systems/SystemMapper.js";

/**
 * Registers the required document hooks.
 * Executed during the Foundry 'ready' phase.
 */
export function registerDocumentWatchers() {
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
    const updateDetails = extractUpdateDetails(update);
    if (updateDetails.length === 0) return;

    const itemType = formatDocumentType(item.type);
    const itemContext = `${itemType} (${item.name})`;

    const logEntry = {
        userId: userId,
        actorName: item.parent.name,
        action: "Item Modified",
        detail: `${itemContext} | ${updateDetails.join(" | ")}`,
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

    const updateDetails = extractUpdateDetails(update);
    if (updateDetails.length === 0) return;

    const logEntry = {
        userId: userId,
        actorName: effect.parent.name,
        action: "Active Effect Modified",
        detail: `Effect (${effect.name}) | ${updateDetails.join(" | ")}`,
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

    const details = extractUpdateDetails(update);
    if (details.length === 0) return;

    const logEntry = {
        userId: userId,
        actorName: actor.name,
        action: "Data Modified",
        detail: details.join(" | "),
        timestamp: Date.now(),
    };

    StateManager.addLog(logEntry);
}

/**
 * Examines the update object and extracts flattened keys and their new values.
 * @param {object} update - The diff object provided by the hook.
 * @returns {Array<string>} - A formatted list of exact changes.
 */
function extractUpdateDetails(update) {
    const details = [];

    // 1. Explicit top-level checks
    if (update.name) details.push(`Name ➔ ${update.name}`);
    if (update.prototypeToken) details.push("Token Settings Modified");

    // 2. Flatten the entire payload to safely catch BOTH nested and flat data structures
    const flatUpdate = foundry.utils.flattenObject(update);

    for (const [key, value] of Object.entries(flatUpdate)) {
        if (key.startsWith("system.")) {
            details.push(`${key} ➔ ${formatDisplayValue(value)}`);
        }
    }

    return details;
}

/**
 * Formats a raw database value into a safe, readable string for the UI.
 * @param {*} value - The raw value from the database delta.
 * @returns {string|number|boolean} - The formatted display value.
 */
function formatDisplayValue(value) {
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
