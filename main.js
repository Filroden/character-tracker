/**
 * The primary entry point for the Character Tracker module.
 * Orchestrates the initialisation and setup phases.
 */

import { registerSettings } from "./src/config/settings.js";
import { StateManager } from "./src/data/StateManager.js";
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
 * Prepares the state cache and begins watching document events.
 */
function readyModule() {
    console.log("Character Tracker | Module ready.");

    StateManager.initialize();
    SystemMapper.initialize();
    registerDocumentWatchers();
}
