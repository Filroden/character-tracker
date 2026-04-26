/**
 * Dictionary mapping for the Rolemaster Unified (RMU) system.
 */

export const rmuDictionary = {
    // Health & Power
    "system.health.hp.value": "rmu.health.hp",
    "system.health.hp.max": "rmu.health.hp",
    "system.health.power.value": "rmu.health.power",
    "system.health.innatePower.value": "RMU.Vitals.InnatePP",

    // Experience & Progression
    "system.experience.level": "RMU.Terms.Level",
    "system.experience.xp": "RMU.Terms.XP",
    "system.powerLevel": "RMU.Terms.PowerLevel",
    "system.experience.carryOverDP": "RMU.Terms.BankedDP",

    // Appearance & Identity
    "system.appearance.sex": "RMU.Terms.SexColon",
    "system.appearance.age": "RMU.Terms.AgeColon",
    "system.identity.faith": "RMU.Terms.FaithColon",

    // Core Stats (Mapping the 'tmp' value as the primary tracked stat)
    "system.stats.Ag.tmp": "rmu.statsName.Ag",
    "system.stats.Co.tmp": "rmu.statsName.Co",
    "system.stats.Em.tmp": "rmu.statsName.Em",
    "system.stats.In.tmp": "rmu.statsName.In",
    "system.stats.Me.tmp": "rmu.statsName.Me",
    "system.stats.Pr.tmp": "rmu.statsName.Pr",
    "system.stats.Qu.tmp": "rmu.statsName.Qu",
    "system.stats.Re.tmp": "rmu.statsName.Re",
    "system.stats.SD.tmp": "rmu.statsName.SD",
    "system.stats.St.tmp": "rmu.statsName.St",

    // Additional RMU keys can be mapped directly to their native i18n strings here
};
