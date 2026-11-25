/**
 * The primary entry point for the Character Tracker module.
 * Orchestrates the initialisation and setup phases.
 */

import { registerSettings } from "./src/config/settings.js";
import { StateManager } from "./src/data/StateManager.js";
import { PendingLogMerger } from "./src/data/PendingLogMerger.js";
import { registerDocumentWatchers } from "./src/hooks/documentWatchers.js";
import { registerSidebarInjection } from "./src/ui/sidebarInjection.js";
import { SystemMapper } from "./src/systems/SystemMapper.js";

/**
 * Hook listeners for the Foundry lifecycle.
 */
Hooks.once("init", initializeModule);
Hooks.once("ready", readyModule);

/**
 * Handles the initialisation logic before the DOM is fully ready.
 * Registers settings, API integrations, and sheet modifications.
 */
function initializeModule() {
    console.log("Character Tracker | Initializing module...");

    registerSettings();
    registerSidebarInjection();
}

/**
 * Handles the ready logic after the game world has fully loaded.
 * Prepares the state cache, begins watching document events, and (on the active GM's client)
 * merges any changes that players' clients queued while no GM was connected.
 * The merge must run after StateManager.initialize, otherwise the freshly loaded log would
 * overwrite the merged entries.
 */
function readyModule() {
    console.log("Character Tracker | Module ready.");

    StateManager.initialize();
    SystemMapper.initialize();
    registerDocumentWatchers();
    PendingLogMerger.register();
    PendingLogMerger.mergeAll();
}
