/**
 * Queues log entries on an actor's flags while no GM is connected.
 *
 * Module code only runs in logged-in clients, and the main log lives in a world setting that only a
 * GM can write. When no GM is online, the client of the player who made a change therefore stores
 * the entry on the actor itself (which that player owns and can write to). A GM client later moves
 * these entries into the main log (see PendingLogMerger).
 *
 * Storage shape: `flags.character-tracker.pendingLogs.<pendingId> = logEntry`.
 * Each entry has its own random key so that the database merges concurrent writes from different
 * players who share an actor, rather than one client overwriting another's array.
 */

import { MODULE_ID, FLAG_KEYS, SYSTEM_CONFIG } from "../config/settings.js";

const PENDING_FLAG_PATH = `flags.${MODULE_ID}.${FLAG_KEYS.PENDING_LOGS}`;

/**
 * Builds the update options attached to every flag write the module makes, so the document watchers
 * can recognise and ignore the module's own updates instead of treating them as player changes.
 * A fresh object is built for each update because other hooks may add their own data under the
 * module's options key during the update, and a shared object would carry that data between updates.
 * @returns {object} - The update options.
 */
function buildInternalUpdateOptions() {
    return { [MODULE_ID]: { internal: true } };
}

/**
 * Checks whether an update was made by this module's own bookkeeping.
 * @param {object} options - The options object passed to an update hook.
 * @returns {boolean} - True if the update came from the module itself.
 */
export function isInternalUpdate(options) {
    return options?.[MODULE_ID]?.internal === true;
}

export class PendingLogQueue {
    /**
     * Entries waiting to be written, grouped by actor ID.
     * @type {Map<string, {actor: Actor, entries: Object<string, object>}>}
     */
    static #buffers = new Map();

    /**
     * Batches rapid sequential changes (such as several fields edited in quick succession) into one
     * actor update per actor, which avoids a separate database write and sheet re-render per change.
     */
    static #debouncedFlush = foundry.utils.debounce(() => PendingLogQueue.#flushAll(), SYSTEM_CONFIG.SAVE_DELAY_MS);

    /**
     * Queues a log entry against the actor it relates to.
     * The entry is tagged with a unique `pendingId` (used by the GM client to avoid merging the same
     * entry twice) and a `recordedWithoutGM` marker (shown in the log window, because entries stored on
     * a player-owned actor could in principle have been edited by that player before the merge).
     * @param {Actor} actor - The world actor the change was made to. The current user must own it.
     * @param {object} logEntry - The formatted log data object.
     */
    static queue(actor, logEntry) {
        if (!actor?.isOwner) return;

        const pendingId = foundry.utils.randomID();
        const buffer = PendingLogQueue.#getBuffer(actor);
        buffer.entries[pendingId] = { ...logEntry, pendingId, recordedWithoutGM: true };

        PendingLogQueue.#debouncedFlush();
    }

    /**
     * Returns the write buffer for an actor, creating it if needed.
     * @param {Actor} actor - The actor to buffer entries for.
     * @returns {{actor: Actor, entries: Object<string, object>}} - The buffer.
     */
    static #getBuffer(actor) {
        if (!PendingLogQueue.#buffers.has(actor.id)) {
            PendingLogQueue.#buffers.set(actor.id, { actor, entries: {} });
        }
        return PendingLogQueue.#buffers.get(actor.id);
    }

    /**
     * Writes every buffered entry to its actor. The buffers are swapped out before any awaiting, so
     * entries queued while a write is in flight go into a fresh buffer and the next flush.
     */
    static async #flushAll() {
        const buffers = [...PendingLogQueue.#buffers.values()];
        PendingLogQueue.#buffers.clear();

        for (const buffer of buffers) {
            await PendingLogQueue.#flushBuffer(buffer);
        }
    }

    /**
     * Writes one actor's buffered entries and then trims its queue to the storage cap.
     * Errors are logged rather than thrown (for example if the actor was deleted before the flush),
     * so one failed actor does not block the others.
     * @param {{actor: Actor, entries: Object<string, object>}} buffer - The buffer to write.
     */
    static async #flushBuffer({ actor, entries }) {
        const update = {};
        for (const [pendingId, entry] of Object.entries(entries)) {
            update[`${PENDING_FLAG_PATH}.${pendingId}`] = entry;
        }

        try {
            await actor.update(update, buildInternalUpdateOptions());
            await PendingLogQueue.#enforceStorageLimit(actor);
        } catch (error) {
            console.error(`Character Tracker | Failed to queue changes on actor ${actor.id}.`, error);
        }
    }

    /**
     * Removes the oldest queued entries once an actor holds more than the cap. This only happens if a
     * very long time passes with no GM connecting, so removing them one at a time is acceptable.
     * `unsetFlag` is used because it builds the correct deletion syntax for the running core version.
     * @param {Actor} actor - The actor whose queue to trim.
     */
    static async #enforceStorageLimit(actor) {
        const pending = actor.getFlag(MODULE_ID, FLAG_KEYS.PENDING_LOGS) ?? {};
        const excessCount = Object.keys(pending).length - SYSTEM_CONFIG.MAX_PENDING_ENTRIES;
        if (excessCount <= 0) return;

        const oldestIds = Object.values(pending)
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(0, excessCount)
            .map((entry) => entry.pendingId);

        for (const pendingId of oldestIds) {
            await actor.unsetFlag(MODULE_ID, `${FLAG_KEYS.PENDING_LOGS}.${pendingId}`);
        }
    }
}
