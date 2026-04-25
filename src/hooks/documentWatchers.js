/**
 * Intercepts core document events to build the audit log.
 */

import { StateManager } from "../data/StateManager.js";

/**
 * Registers the required document hooks.
 * Executed during the Foundry 'ready' phase.
 */
export function registerDocumentWatchers() {
    Hooks.on("createItem", handleItemCreation);
    Hooks.on("deleteItem", handleItemDeletion);
    Hooks.on("updateActor", handleActorUpdate);
}

/**
 * Validates if the current client should process this event based on user permissions.
 * @param {string} initiatingUserId - The ID of the user who triggered the event.
 * @returns {boolean} - True if this client should process the log.
 */
function shouldProcessLog(initiatingUserId) {
    if (game.users.activeGM?.id !== game.user.id) return false;

    const initiatingUser = game.users.get(initiatingUserId);
    if (!initiatingUser || initiatingUser.isGM) return false;

    return true;
}

/**
 * Handles the creation of an embedded Item.
 */
function handleItemCreation(item, options, userId) {
    if (!shouldProcessLog(userId)) return;
    if (item.parent?.documentName !== "Actor") return;
    if (item.parent.isToken) return;

    const logEntry = {
        userId: userId,
        actorName: item.parent.name,
        action: "Item Added",
        detail: item.name,
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

    const logEntry = {
        userId: userId,
        actorName: item.parent.name,
        action: "Item Removed",
        detail: item.name,
        timestamp: Date.now(),
    };

    StateManager.addLog(logEntry);
}

/**
 * Handles modifications to the Actor document.
 */
function handleActorUpdate(actor, update, options, userId) {
    if (!shouldProcessLog(userId)) return;
    if (actor.isToken) return;

    const categories = extractUpdateCategories(update);
    if (categories.length === 0) return;

    const logEntry = {
        userId: userId,
        actorName: actor.name,
        action: "Data Modified",
        detail: `Updated areas: ${categories.join(", ")}`,
        timestamp: Date.now(),
    };

    StateManager.addLog(logEntry);
}

/**
 * Examines the update object keys to broadly categorise what changed.
 * @param {object} update - The diff object provided by the hook.
 * @returns {Array<string>} - A list of modified categories.
 */
function extractUpdateCategories(update) {
    const categories = [];

    // Captures top-level Foundry document changes
    if (update.name) categories.push("Core Name");
    if (update.prototypeToken) categories.push("Token Settings");

    // Looks one level into the system data for better context
    if (update.system) {
        const systemModifiedKeys = Object.keys(update.system);

        if (systemModifiedKeys.length > 0) {
            categories.push(`System (${systemModifiedKeys.join(", ")})`);
        } else {
            categories.push("System Mechanics");
        }
    }

    return categories;
}
