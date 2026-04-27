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
