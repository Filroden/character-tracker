/**
 * Finds "net zero" changes in the audit log: things a player did and later undid themselves.
 *
 * Nothing here alters the stored log. The results are only used by the log window to fold reverted
 * changes into a single summary line, so a GM can still expand them and every entry stays in the
 * database and in exports. Keeping every entry matters because the log is an audit record: if a
 * player briefly adds a bonus, uses it and removes it, that still needs to be visible on request.
 *
 * Two kinds of reversal are detected, and both require the same player to have made every change
 * involved, on the same actor:
 *   1. Entity reversals: an item or active effect was added and later removed. The add, the
 *      removal and that player's own edits to it in between are all folded.
 *   2. Data reversals: a field was changed and later changed back to its original value, through an
 *      unbroken run of changes to that field by the same player. A change by anyone else to that
 *      field breaks the run, because the field's history then involves more than one person.
 *
 * Entries recorded before old values were captured (no `from` on their change records) cannot be
 * checked for a data reversal and are never folded.
 */

const ENTITY_ACTIONS = Object.freeze({
    ADDED: new Set(["Item Added", "Active Effect Added"]),
    MODIFIED: new Set(["Item Modified", "Active Effect Modified"]),
    REMOVED: new Set(["Item Removed", "Active Effect Removed"]),
});

const DATA_ACTION = "Data Modified";

/**
 * The kinds of summary produced, so the log window can format each one.
 */
export const REVERSION_KINDS = Object.freeze({
    ENTITY: "entity",
    DATA: "data",
});

/**
 * Detects reversals across the whole log.
 * The whole log (every player) must be passed in, not one player's slice, because a data run is
 * broken by another player's change to the same field.
 * @param {Array<object>} logs - Every log entry, oldest first.
 * @returns {{revertedLogs: Set<object>, revertedKeys: Map<object, Set<string>>, summaries: Map<object, Array<object>>}}
 *   - revertedLogs: entries whose every change was reverted (folded away entirely).
 *   - revertedKeys: for each data entry, the keys within it that were reverted.
 *   - summaries: summary records keyed by the entry that completed the reversal, so a summary can be
 *     shown at the point in time where the change was undone.
 */
export function findReversions(logs) {
    const result = { revertedLogs: new Set(), revertedKeys: new Map(), summaries: new Map() };

    findEntityReversions(logs, result);
    findDataReversions(logs, result);
    markFullyRevertedDataLogs(result);

    return result;
}

/**
 * Adds a summary against the entry that completed a reversal.
 * @param {object} result - The shared result object.
 * @param {object} closingLog - The entry that completed the reversal.
 * @param {object} summary - The summary record.
 */
function addSummary(result, closingLog, summary) {
    if (!result.summaries.has(closingLog)) result.summaries.set(closingLog, []);
    result.summaries.get(closingLog).push(summary);
}

/**
 * Builds the fields every summary shares.
 * @param {Array<object>} members - The entries folded into the summary, oldest first.
 * @returns {object} - Start and end times, author, actor and No GM marker.
 */
function describeMembers(members) {
    const first = members[0];
    const last = members.at(-1);
    return {
        userId: first.userId,
        actorName: first.actorName,
        start: first.timestamp,
        end: last.timestamp,
        recordedWithoutGM: members.some((log) => log.recordedWithoutGM),
        members,
    };
}

/* ===================================================================
   --- ENTITY REVERSALS (items and effects) ---
=================================================================== */

/**
 * Pairs each item or effect "Added" entry with a later "Removed" entry by the same player.
 * Entries are tracked by actor and document ID, so two items that share a name never pair up.
 * Legacy entries without a document ID are skipped.
 * @param {Array<object>} logs - Every log entry, oldest first.
 * @param {object} result - The shared result object.
 */
function findEntityReversions(logs, result) {
    const open = new Map();

    for (const log of logs) {
        if (!log.entityId) continue;
        const trackingKey = `${log.actorName}|${log.entityId}`;

        if (ENTITY_ACTIONS.ADDED.has(log.action)) open.set(trackingKey, [log]);
        else if (ENTITY_ACTIONS.MODIFIED.has(log.action)) trackModification(open.get(trackingKey), log);
        else if (ENTITY_ACTIONS.REMOVED.has(log.action)) closeEntity(open, trackingKey, log, result);
    }
}

/**
 * Adds an edit to an open item or effect, but only if the player who added it made the edit.
 * Edits by anyone else stay visible as normal entries.
 * @param {Array<object>|undefined} members - The open entries for this document, if any.
 * @param {object} log - The "Modified" entry.
 */
function trackModification(members, log) {
    if (members && log.userId === members[0].userId) members.push(log);
}

/**
 * Completes an entity reversal if the same player who added the document removed it.
 * The document is no longer open afterwards either way, because a removed document cannot come back
 * with the same ID.
 * @param {Map<string, Array<object>>} open - Open documents by tracking key.
 * @param {string} trackingKey - This document's tracking key.
 * @param {object} log - The "Removed" entry.
 * @param {object} result - The shared result object.
 */
function closeEntity(open, trackingKey, log, result) {
    const members = open.get(trackingKey);
    open.delete(trackingKey);
    if (!members || log.userId !== members[0].userId) return;

    members.push(log);
    members.forEach((member) => result.revertedLogs.add(member));
    addSummary(result, log, { kind: REVERSION_KINDS.ENTITY, ...describeMembers(members), closingLog: log });
}

/* ===================================================================
   --- DATA REVERSALS (actor fields) ---
=================================================================== */

/**
 * Finds fields that were changed and then changed back by the same player.
 * @param {Array<object>} logs - Every log entry, oldest first.
 * @param {object} result - The shared result object.
 */
function findDataReversions(logs, result) {
    for (const history of collectFieldHistories(logs).values()) {
        for (const run of splitIntoRuns(history)) {
            foldRun(run, result);
        }
    }
}

/**
 * Groups every structured data change by actor and field, oldest first.
 * Summary-only records (such as token settings, which have no `to`) are left out because they have
 * no value to compare.
 * @param {Array<object>} logs - Every log entry, oldest first.
 * @returns {Map<string, Array<{log: object, change: object}>>} - Field histories by "actor|key".
 */
function collectFieldHistories(logs) {
    const histories = new Map();

    for (const log of logs) {
        if (log.action !== DATA_ACTION || !Array.isArray(log.changes)) continue;

        for (const change of log.changes) {
            if (!("to" in change)) continue;

            const historyKey = `${log.actorName}|${change.key}`;
            if (!histories.has(historyKey)) histories.set(historyKey, []);
            histories.get(historyKey).push({ log, change });
        }
    }

    return histories;
}

/**
 * Splits a field's history into unbroken runs of changes by one player.
 * @param {Array<{log: object, change: object}>} history - One field's changes, oldest first.
 * @returns {Array<Array<{log: object, change: object}>>} - The runs, in order.
 */
function splitIntoRuns(history) {
    const runs = [];

    for (const step of history) {
        const currentRun = runs.at(-1);
        if (currentRun && currentRun[0].log.userId === step.log.userId) currentRun.push(step);
        else runs.push([step]);
    }

    return runs;
}

/**
 * Finds reversals within one run. Starting from each change, it looks for the latest later change in
 * the run that sets the field back to that change's old value. Taking the latest match folds the
 * longest stretch that ends where it began (for example 50 ➔ 55 ➔ 60 ➔ 50 folds all three).
 * Scanning then continues after the folded stretch, so stretches never overlap.
 * @param {Array<{log: object, change: object}>} run - Changes to one field by one player, oldest first.
 * @param {object} result - The shared result object.
 */
function foldRun(run, result) {
    let start = 0;

    while (start < run.length) {
        const end = findReturnIndex(run, start);
        if (end === -1) {
            start++;
            continue;
        }

        recordDataReversion(run.slice(start, end + 1), result);
        start = end + 1;
    }
}

/**
 * Finds the latest change in a run that restores the old value of the change at `start`.
 * @param {Array<{log: object, change: object}>} run - The run.
 * @param {number} start - Index of the starting change.
 * @returns {number} - Index of the restoring change, or -1 if there is none.
 */
function findReturnIndex(run, start) {
    const { change } = run[start];
    if (!("from" in change)) return -1;

    for (let index = run.length - 1; index > start; index--) {
        if (sameValue(run[index].change.to, change.from)) return index;
    }
    return -1;
}

/**
 * Records a folded stretch of changes to one field.
 * @param {Array<{log: object, change: object}>} stretch - The folded changes, oldest first.
 * @param {object} result - The shared result object.
 */
function recordDataReversion(stretch, result) {
    const { key, from } = stretch[0].change;
    const closingLog = stretch.at(-1).log;

    for (const { log } of stretch) {
        if (!result.revertedKeys.has(log)) result.revertedKeys.set(log, new Set());
        result.revertedKeys.get(log).add(key);
    }

    const members = [...new Set(stretch.map((step) => step.log))];
    addSummary(result, closingLog, { kind: REVERSION_KINDS.DATA, ...describeMembers(members), key, value: from, closingLog });
}

/**
 * Marks data entries as fully reverted when every change they carry was reverted. An entry with
 * even one change that still stands (or a summary-only change, such as token settings) stays visible.
 * @param {object} result - The shared result object.
 */
function markFullyRevertedDataLogs(result) {
    for (const [log, keys] of result.revertedKeys) {
        if (log.changes.every((change) => keys.has(change.key))) result.revertedLogs.add(log);
    }
}

/**
 * Compares two stored values as text. Values can be stored as numbers or as strings depending on the
 * system's data model, and both forms should count as the same value.
 * @param {*} a - First value.
 * @param {*} b - Second value.
 * @returns {boolean} - True if they display the same.
 */
function sameValue(a, b) {
    return String(a) === String(b);
}
