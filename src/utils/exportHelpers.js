/**
 * Handles the formatting and native file exporting of audit logs.
 */

import { StateManager } from "../data/StateManager.js";

const EXPORT_CONFIG = {
    EXTENSION: ".txt",
    MIME_TYPE: "text/plain",
    PREFIX: "character-tracker",
};

/**
 * Compiles a player's log into a text string and triggers a native file download.
 * @param {string} userId - The ID of the player whose logs are being exported.
 * @param {string} playerName - The name of the player for the file title.
 */
export function exportPlayerLogs(userId, playerName) {
    const logs = StateManager.getLogs(userId);
    if (logs.length === 0) return;

    const fileContent = formatLogsForExport(logs, playerName);
    const fileName = generateFileName(playerName);

    // Natively provided by Foundry VTT core
    foundry.utils.saveDataToFile(fileContent, EXPORT_CONFIG.MIME_TYPE, fileName);
}

/**
 * Formats the raw log objects into a readable plain-text structure.
 * @param {Array<object>} logs - The array of log entries.
 * @param {string} playerName - The name of the player.
 * @returns {string} - The fully compiled text document.
 */
function formatLogsForExport(logs, playerName) {
    let content = `Character Tracker | Audit Log for ${playerName}\n`;
    content += `Exported: ${new Date().toLocaleString()}\n`;
    content += `=================================================\n\n`;

    const formattedEntries = logs.map((log) => {
        const time = new Date(log.timestamp).toLocaleString();
        return `[${time}] ${log.actorName}\nAction: ${log.action}\nDetails: ${log.detail}\n`;
    });

    return content + formattedEntries.join("\n");
}

/**
 * Generates a safe file name based on the player's name.
 * @param {string} playerName - The name of the player.
 * @returns {string} - The formatted file name.
 */
function generateFileName(playerName) {
    // Replaces spaces and non-alphanumeric characters with dashes for file system safety
    const safeName = playerName
        .toLowerCase()
        .replaceAll(/[^a-z0-9]/g, "-")
        .replaceAll(/-+/g, "-");
    return `${EXPORT_CONFIG.PREFIX}-${safeName}${EXPORT_CONFIG.EXTENSION}`;
}
