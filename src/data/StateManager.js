/**
 * Handles memory caching and database synchronisation of audit logs.
 */

import { MODULE_ID, SETTING_KEYS, SYSTEM_CONFIG } from "../config/settings.js";

export class StateManager {
    static #sessionLogs = [];

    /**
     * Debounces the database write to execute only after a period of silence.
     * This prevents database locking during rapid sequential updates.
     */
    static #debouncedSave = foundry.utils.debounce(async () => {
        await game.settings.set(MODULE_ID, SETTING_KEYS.LOG_STORE, StateManager.#sessionLogs);
    }, SYSTEM_CONFIG.SAVE_DELAY_MS);

    /**
     * Loads the logs from the world database into memory.
     * This must be called during the Foundry 'ready' hook.
     */
    static initialize() {
        StateManager.#sessionLogs = game.settings.get(MODULE_ID, SETTING_KEYS.LOG_STORE);
    }

    /**
     * Adds a new log entry, enforces the storage cap, and queues a background save.
     * @param {object} logEntry - The formatted log data object.
     */
    static addLog(logEntry) {
        StateManager.#sessionLogs.push(logEntry);
        StateManager.#enforceStorageLimit();
        StateManager.#debouncedSave();
    }

    /**
     * Adds entries that were queued on actors while no GM was connected.
     * Entries already in the log (matched by their `pendingId`) are skipped, so merging the same
     * queue twice is harmless. The log is then re-sorted by timestamp, because queued entries can be
     * older than entries recorded directly since they were queued. Array sorting is stable, so entries
     * that share a timestamp keep their existing relative order. The storage cap is applied after
     * sorting so that the oldest entries are the ones removed, wherever they came from.
     * @param {Array<object>} entries - The queued log entries, each carrying a `pendingId`.
     * @returns {number} - The number of entries actually added.
     */
    static addMergedLogs(entries) {
        const knownIds = new Set(StateManager.#sessionLogs.map((log) => log.pendingId).filter(Boolean));
        const freshEntries = entries.filter((entry) => !knownIds.has(entry.pendingId));
        if (freshEntries.length === 0) return 0;

        StateManager.#sessionLogs.push(...freshEntries);
        StateManager.#sessionLogs.sort((a, b) => a.timestamp - b.timestamp);
        StateManager.#enforceStorageLimit();
        StateManager.#debouncedSave();

        return freshEntries.length;
    }

    /**
     * Retrieves logs, optionally filtered by a specific player's ID.
     * @param {string|null} userId - The ID of the user to filter by.
     * @returns {Array<object>} - A shallow copy of the filtered logs.
     */
    static getLogs(userId = null) {
        if (!userId) return [...StateManager.#sessionLogs];

        return StateManager.#sessionLogs.filter((log) => log.userId === userId);
    }

    /**
     * Clears logs from memory and immediately forces a synchronous database save.
     * @param {string|null} userId - The ID of the user whose logs should be cleared.
     */
    static async clearLogs(userId = null) {
        if (userId) {
            StateManager.#sessionLogs = StateManager.#sessionLogs.filter((log) => log.userId !== userId);
        } else {
            StateManager.#sessionLogs = [];
        }

        await game.settings.set(MODULE_ID, SETTING_KEYS.LOG_STORE, StateManager.#sessionLogs);
    }

    /**
     * Truncates the array from the beginning (oldest entries) to maintain the maximum size.
     */
    static #enforceStorageLimit() {
        if (StateManager.#sessionLogs.length <= SYSTEM_CONFIG.MAX_ENTRIES) return;

        const excessCount = StateManager.#sessionLogs.length - SYSTEM_CONFIG.MAX_ENTRIES;
        StateManager.#sessionLogs.splice(0, excessCount);
    }
}
