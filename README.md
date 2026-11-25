# Character Tracker

![Latest Version](https://img.shields.io/badge/Version-1.3.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v13_%7C_v14-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System Agnostic](https://img.shields.io/badge/System-Agnostic-green)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Download Count](https://img.shields.io/github/downloads/Filroden/character-tracker/character-tracker.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/character-tracker/latest/character-tracker.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/character-tracker)
![Issues](https://img.shields.io/github/issues/Filroden/character-tracker)

## Welcome to Character Tracker

This module provides a system-agnostic tracker for any changes made by players to characters (actors) they control. As a game option, the module can also track changes made by GMs to any player-owned actors.

This is a valuable tool for GMs to review character sheet modifications, such as during levelling up, particularly if you leave your game server accessible between live sessions. Changes are recorded even when no GM is logged in (see [Recording Changes When No GM Is Online](#recording-changes-when-no-gm-is-online)).

![Character Tracker](https://github.com/Filroden/character-tracker/blob/main/screenshots/character-tracker.png)

The module tracks:

- Modifications to core system data (e.g., stats, health, experience), showing both the previous and the new value (e.g., `Strength: 50 ➔ 55`).
- Adding, removing, or modifying embedded items and active effects.
- Changes players make while no GM is logged in, which are added to the log the next time a GM logs in.

## How to use the Character Tracker

1. **Open the Character Tracker window**: A new icon is available at the top of the `Actors` sidebar to open the interface.

   ![Character Tracker View Button](https://github.com/Filroden/character-tracker/blob/main/screenshots/character-tracker-view-button.png)

2. **Choosing a player**: The panel on the left lists every player (and GMs, if `Track GM Changes` is on), with the number of changes logged for each. Click a name to show that player's log. Players with nothing logged are shown in a quieter colour.
3. **Reading the log**: The bar above the log shows the player's name, how many changes they have made and when they last made one. Below it, each of the player's characters has its own card, which you can open or close. The first card starts open, and the window remembers which cards you opened or closed while it stays open.
4. **Switching the view**: Use `Timeline` and `By category` in the bar above the log. The timeline lists every change, newest first (ideal for seeing what was changing at the same time). The categorical view groups changes by type (core data, items and active effects), and then by the specific stat, item or effect, so you can follow the history of one thing. A stat, item or effect with a single change shows that change directly.
5. **Reverted changes**: When a player makes a change and later undoes it themselves (such as adding an effect and then removing it), the pair is folded into one dashed line. Turn on `Expand reverted changes` to see every original entry, faded and marked `Reverted`. Nothing is ever removed from the log or from exports.
6. **Spotting changes made with no GM online**: Entries recorded while no GM was logged in carry a `No GM` mark beside the action. Hover over the mark for an explanation. The mark also appears in exported logs.
7. **Saving, refreshing and clearing**: The buttons at the end of the bar above the log refresh the window, export the player's log to a text file, and clear the player's log. `Clear all logs…` at the foot of the player list deletes every player's log. Both clear buttons ask you to confirm first, and the confirming button names exactly what will be deleted.
8. **Appearance**: The palette button beside `Players` chooses the window's accent colour (gold or blue). Each user's choice is saved for them alone. Light or dark follows Foundry's own interface theme.

### Settings

| Setting | Default | What it does |
| :--- | :--- | :--- |
| `Track GM Changes` | Off | Also records changes GMs make to player-owned characters. |
| `Record Changes When No GM Is Online` | On | Records changes players make while no GM is logged in, and adds them to the log when a GM next logs in. |

### Recording Changes When No GM Is Online

Many groups leave their Foundry server running between sessions so players can level up or tidy their character sheets in their own time, often with no GM logged in. Foundry only runs modules in the browsers of users who are logged in, and only a GM can save to the Character Tracker log, so the module handles this in three steps:

1. **A player changes their character while no GM is online.** The player's own browser saves a record of each change on the character itself (in the character's data, where the player already has permission to write).
2. **The records wait on the character.** They stay there until a GM logs in. Nothing is lost if the player logs out, or if the server is restarted.
3. **A GM logs in.** The GM's browser collects the saved records from every character, adds them to the main log in the order the changes were made, and removes them from the characters.

If a GM is already logged in, changes are recorded straight into the log as normal, and nothing is saved on the character.

#### What to be aware of

- **Entries are marked.** Anything recorded this way shows a `No GM` badge in the log window and in exports, so you can tell it apart from changes recorded while you were online.
- **Players could, in principle, alter these entries.** Because the records sit on a character the player owns, a player with the technical know-how (for example, using a macro or the browser console) could edit or delete them before a GM logs in. Treat `No GM` entries as a helpful record rather than proof. As a safeguard, any entry that names a user who does not own that character is thrown away when it is collected.
- **Deleted characters lose their records.** If a character is deleted before a GM logs in, the changes saved on it are deleted with it.
- **Shared characters work.** If several players own the same character, each player's changes are saved separately and none overwrite another's.
- **Storage is capped.** Each character holds up to 500 waiting records. If more build up before a GM logs in, the oldest are removed first.

#### Turning it off

Recording with no GM online is controlled by the `Record Changes When No GM Is Online` world setting, which is on by default. If you turn it off, changes made while no GM is logged in are not recorded at all. Any records already saved on characters are still collected the next time a GM logs in, so turning the setting off never loses changes that were already saved.

### System-Specific Dictionaries and Localisation

Whilst the module works with any system, system-specific dictionaries can be added to convert standard dot-notation database keys (e.g., `system.health.hp.value`) into more easily readable text (e.g., `Hit Points`). If the game system provides its own localisation files, the tracker maps to these keys, making sure it can translate into any language supported by the system.

An example dictionary is included for the Rolemaster Unified (RMU) system.

## Licences

Character Tracker is released under the [MIT Licence](https://mit-license.org/).

It includes the following third-party assets, each kept with its licence in the repository:

| Asset | Copyright | Licence | Location |
| :--- | :--- | :--- | :--- |
| [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/) typeface | Braille Institute of America, Inc. | [SIL Open Font License 1.1](fonts/LICENSE-atkinson-hyperlegible.txt) | `fonts/` |
| [Sora](https://github.com/sora-xor/sora-font) typeface | The Sora Project Authors | [SIL Open Font License 1.1](fonts/LICENSE-sora.txt) | `fonts/` |
| [Barlow Semi Condensed](https://github.com/jpt/barlow) typeface | The Barlow Project Authors | [SIL Open Font License 1.1](fonts/LICENSE-barlow-semi-condensed.txt) | `fonts/` |
| [Material icons](https://fonts.google.com/icons) | Google | [Apache Licence 2.0](icons/icons-licence.md) | `icons/` |

The typefaces are included as Latin subsets in WOFF2 format, and are used only inside the Character Tracker window.

## Roadmap

These features are planned for future updates, in no particular order:

- Add dictionaries for other popular systems.
- Extract deeper, system-specific details from items and active effects.
