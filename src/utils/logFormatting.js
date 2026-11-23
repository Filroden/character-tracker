/**
 * Shared formatting for the structured change records stored on log entries.
 *
 * Each record in a log entry's `changes` array is a plain, JSON-serialisable object:
 *   { key: "system.stats.St", from: 50, to: 55 }
 * - `key` is the flattened document path (or one of the special keys in CHANGE_KEYS).
 * - `from` is only present when the previous value was captured before the update ran.
 *   Entries recorded before this field existed, or updates whose previous value could not be
 *   captured, omit it and are shown in the original "key ➔ new" shape.
 * - `to` is omitted for summary-only records (such as token settings) that have no single value.
 *
 * Both the document watchers (which build the stored, exported `detail` string) and the audit
 * log window (which rebuilds the text with translated keys) use the same formatter, so the two
 * never drift apart.
 */

export const CHANGE_SEPARATOR = " | ";
export const VALUE_ARROW = " ➔ ";

/**
 * Special keys used for changes that are not flattened `system.*` paths.
 */
export const CHANGE_KEYS = {
    NAME: "name",
    TOKEN: "prototypeToken",
};

/**
 * Fixed labels for the special keys. These match the wording stored in logs recorded before
 * structured changes existed, so old and new entries read the same way.
 */
const SPECIAL_LABELS = {
    [CHANGE_KEYS.NAME]: "Name",
    [CHANGE_KEYS.TOKEN]: "Token Settings Modified",
};

/**
 * Returns the default label for a change record's key.
 * @param {object} change - A structured change record.
 * @returns {string} - The fixed label for a special key, otherwise the raw key.
 */
export function defaultChangeLabel(change) {
    return SPECIAL_LABELS[change.key] ?? change.key;
}

/**
 * Formats one structured change record into a readable line.
 * @param {object} change - A structured change record.
 * @param {string} [label] - The label to show for the key (for example, a translated system key).
 * @returns {string} - "label: was ➔ now", "label ➔ now" when no previous value exists,
 *                     or just the label for summary-only records.
 */
export function formatChange(change, label = defaultChangeLabel(change)) {
    if (!("to" in change)) return label;
    if (!("from" in change)) return `${label}${VALUE_ARROW}${change.to}`;

    return `${label}: ${change.from}${VALUE_ARROW}${change.to}`;
}
