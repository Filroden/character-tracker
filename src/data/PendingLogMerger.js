/**
 * Moves log entries queued on actors (see PendingLogQueue) into the main log.
 * Runs only on the active GM's client, because only a GM can write the world setting that holds
 * the main log, and limiting it to the single active GM stops several GM clients merging at once.
 */

import { MODULE_ID, FLAG_KEYS } from "../config/settings.js";
import { StateManager } from "./StateManager.js";

export class PendingLogMerger {
    /**
     * Registers the hook that merges entries arriving while a GM is connected.
     * Entries can still arrive with a GM online: a player's client may not yet have seen the GM
     * connect, or entries may have been queued in a flush that started just before the GM logged in.
     * Executed during the Foundry 'ready' phase.
     */
    static register() {
        Hooks.on("updateActor", PendingLogMerger.#handleActorUpdate);
    }

    /**
     * Merges the queued entries from every world actor.
     * Called once the GM client is ready, after StateManager has loaded the main log.
     * Merging runs regardless of the "record changes when no GM is online" setting, so turning that
     * setting off never strands entries that were queued while it was on.
     */
    static async mergeAll() {
        if (!PendingLogMerger.#isMergingClient()) return;

        for (const actor of game.actors) {
            const pending = actor.getFlag(MODULE_ID, FLAG_KEYS.PENDING_LOGS);
            await PendingLogMerger.#mergeEntries(actor, pending);
        }
    }

    /**
     * Merges entries carried by an actor update.
     * The entries are read from the update diff rather than from the actor, because a concurrent
     * clean-up from an earlier merge may already have removed them from the actor by the time this
     * runs. Reading the diff means every entry that was written is seen at least once.
     * Clean-up updates (flag deletions) carry no valid entries and so end here without a further write,
     * which prevents an update loop.
     * @param {Actor} actor - The updated actor.
     * @param {object} changes - The differential update data.
     */
    static async #handleActorUpdate(actor, changes) {
        if (!PendingLogMerger.#isMergingClient()) return;

        const pending = changes.flags?.[MODULE_ID]?.[FLAG_KEYS.PENDING_LOGS];
        await PendingLogMerger.#mergeEntries(actor, pending);
    }

    /**
     * Adds valid queued entries to the main log, then removes the actor's whole queue.
     * StateManager skips entries whose `pendingId` is already in the log, so it is safe for the same
     * entry to be merged by both the ready-time sweep and the update hook.
     * @param {Actor} actor - The actor the entries were queued on.
     * @param {object|undefined} pending - The queued entries, keyed by pendingId.
     */
    static async #mergeEntries(actor, pending) {
        const entries = PendingLogMerger.#extractValidEntries(actor, pending);
        if (entries.length === 0) return;

        StateManager.addMergedLogs(entries);
        await PendingLogMerger.#clearQueue(actor);
    }

    /**
     * Filters the raw flag data down to well-formed log entries.
     * Flag data is written by player clients, so anything malformed is ignored rather than trusted.
     * This also discards deletion markers that some core versions include in update diffs.
     * @param {Actor} actor - The actor the entries were queued on.
     * @param {object|undefined} pending - The raw queued data.
     * @returns {Array<object>} - The valid entries.
     */
    static #extractValidEntries(actor, pending) {
        if (foundry.utils.getType(pending) !== "Object") return [];
        return Object.values(pending).filter((entry) => PendingLogMerger.#isValidEntry(actor, entry));
    }

    /**
     * Checks that a queued value has the fields the log window depends on, and that it names a user
     * who owns the actor. Only an owner's client can have queued a genuine entry on this actor, so an
     * entry naming any other user cannot be genuine and is dropped.
     * @param {Actor} actor - The actor the entry was queued on.
     * @param {*} entry - The queued value.
     * @returns {boolean} - True if the entry can be safely merged.
     */
    static #isValidEntry(actor, entry) {
        if (foundry.utils.getType(entry) !== "Object") return false;
        if (typeof entry.pendingId !== "string") return false;
        if (!Number.isFinite(entry.timestamp)) return false;

        const author = game.users.get(entry.userId);
        if (!author) return false;
        return actor.testUserPermission(author, "OWNER");
    }

    /**
     * Removes the actor's queue if it still has one. Skipping the write when the queue is already
     * empty avoids a redundant update when a second merge of the same entries reaches this point.
     * @param {Actor} actor - The actor to clean up.
     */
    static async #clearQueue(actor) {
        if (!actor.getFlag(MODULE_ID, FLAG_KEYS.PENDING_LOGS)) return;

        try {
            await actor.unsetFlag(MODULE_ID, FLAG_KEYS.PENDING_LOGS);
        } catch (error) {
            console.error(`Character Tracker | Failed to clear queued changes on actor ${actor.id}.`, error);
        }
    }

    /**
     * Checks whether this client is the one responsible for merging.
     * @returns {boolean} - True if this client is the active GM.
     */
    static #isMergingClient() {
        return game.users.activeGM?.isSelf === true;
    }
}
