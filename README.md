# Character Tracker

![Latest Version](https://img.shields.io/badge/Version-1.0.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v14_%7C_v14-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System Agnostic](https://img.shields.io/badge/System-Agnostic-green)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Download Count](https://img.shields.io/github/downloads/Filroden/character-tracker/character-tracker.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/character-tracker/latest/character-tracker.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/character-tracker)
![Issues](https://img.shields.io/github/issues/Filroden/character-tracker)

## Welcome to Character Tracker

This module provides a system-agnostic tracker for any changes made by players to characters (actors) they control. As a game option, the module can also track changes made by GMs to any player-owned actors.

This is a valuable tool for GMs to review character sheet modifications, such as during levelling up, particularly if you leave your game server accessible between live sessions.

For the initial release, the module tracks:

- Modifications to core system data (e.g., stats, health, experience).
- Adding, removing, or modifying an embedded item.
- Adding or removing active effects.

## How to use the Character Tracker

1. **Open the Character Tracker window**: A new icon is available at the top of the `Actors` sidebar to open the interface.
2. **Navigation**:
   - The left panel displays a list of active players (and GMs, if tracking is enabled). Click a name to jump to their specific logs.
   - The right panel displays the audit log, nested by player and then by their individual characters. A high-level statistics summary is shown first, followed by a detailed chronological log that can be expanded or collapsed.
3. **Saving the Log**: You can export individual logs for each player by clicking the `Download` button next to their name.
4. **Clearing the Log**: You can wipe all logs globally (via the `Delete` button at the bottom of the left panel) or clear individual player logs (via the `Delete` button next to their name).
5. **Refresh the Tracker**: You can see new changes in the interface without closing the window by clicking the `Refresh` button at the bottom of the left panel.

### System-Specific Dictionaries and Localisation

Whilst the module works with any system, system-specific dictionaries can be added to convert standard dot-notation database keys (e.g., `system.health.hp.value`) into more easily readable text (e.g., `Hit Points`). If the game system provides its own localisation files, the tracker maps to those keys, making sure the  log automatically translates into any language supported by the system.

For the initial release, a simple dictionary has been included for the Rolemaster Unified (RMU) system as an example.

## Roadmap

These features are planned for future updates, in no particular order:

- Expand the existing RMU dictionary.
- Add dictionaries for other popular systems.
- Introduce UI filters to isolate specific types of changes within a player's log.
- Extract deeper, system-specific details from items and active effects.
