/**
 * Injects the module's launch button into the native Foundry Actor Directory.
 */

import { AuditLogApp } from "./AuditLogApp.js";

/**
 * Registers the hook to modify the Actor Directory.
 * Executed during the Foundry 'init' phase.
 */
export function registerSidebarInjection() {
    Hooks.on("renderActorDirectory", injectSidebarButton);
}

/**
 * Appends the custom button to the directory header.
 * @param {Application} app - The ActorDirectory instance.
 * @param {jQuery|HTMLElement[]} html - The rendered HTML of the directory.
 */
function injectSidebarButton(app, html) {
    if (!game.user.isGM) return;

    // Ensure we are working with a native HTMLElement, not a jQuery wrapper
    const directoryElement = html[0] || html;
    const actionButtons = directoryElement.querySelector(".directory-header .action-buttons");

    if (!actionButtons) return;

    const button = createAuditButton();
    actionButtons.appendChild(button);
}

/**
 * Constructs the button element and binds its click listener.
 * @returns {HTMLButtonElement}
 */
function createAuditButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-tracker-sidebar-btn";

    // Utilises a flattened localisation key from en.json
    button.dataset.tooltip = game.i18n.localize("character-tracker.ui.buttonTooltip");

    const icon = document.createElement("i");
    icon.className = "fas fa-clipboard-list";
    button.appendChild(icon);

    button.addEventListener("click", handleAuditButtonClick);

    return button;
}

/**
 * Handles the button click to render the ApplicationV2 window.
 * @param {Event} event
 */
function handleAuditButtonClick(event) {
    event.preventDefault();

    // Instantiates and renders the ApplicationV2 UI
    const app = new AuditLogApp();
    app.render({ force: true });
}
