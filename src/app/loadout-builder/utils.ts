import _ from 'lodash';
import { DimPlug, DimItem, D2Item, DimSocket } from 'app/inventory/item-types';
import { statValues, LockedItemType, LockedMod, LockedArmor2Mod } from './types';
import {
  DestinyInventoryItemDefinition,
  TierType,
  DestinyItemSubType,
  DestinyEnergyType,
} from 'bungie-api-ts/destiny2';
import { getSpecialtySocketMetadata } from 'app/utils/item-utils';

/**
 * Plug item hashes that should be excluded from the list of selectable perks.
 */
const unwantedSockets = new Set([
  3313201758, // Mobility, Restorative, and Resilience perks
  1514141499, // Void damage resistance
  1514141501, // Arc damage resistance
  1514141500, // Solar damage resistance
  2973005342, // Shaders
  3356843615, // Ornaments
  2457930460, // Empty masterwork slot
]);
const unwantedCategories = new Set([
  1742617626, // ItemCategory "Armor Mods: Ornaments"
  1875601085, // ItemCategory "Armor Mods: Glow Effects"
  1404791674, // ItemCategory "Ghost Mods: Projections"
]);

/**
 *  Filter out plugs that we don't want to show in the perk picker.
 */
export function filterPlugs(socket: DimSocket) {
  if (!socket.plug) {
    return false;
  }

  const plugItem = socket.plug.plugItem;
  if (!plugItem || !plugItem.plug) {
    return false;
  }

  // Armor 2.0 mods
  if (socket.plug.plugItem.collectibleHash) {
    return false;
  }

  if (
    plugItem.itemSubType === DestinyItemSubType.Ornament ||
    plugItem.itemSubType === DestinyItemSubType.Shader
  ) {
    return false;
  }

  // Remove unwanted sockets by category hash
  if (
    unwantedSockets.has(plugItem.plug.plugCategoryHash) ||
    plugItem.itemCategoryHashes?.some((h) => unwantedCategories.has(h))
  ) {
    return false;
  }

  // Remove Archetype/Inherit perk
  if (
    plugItem.plug.plugCategoryHash === 1744546145 &&
    plugItem.inventory.tierType !== 6 // keep exotics
  ) {
    return false;
  }

  // Remove empty mod slots
  if (
    plugItem.plug.plugCategoryHash === 3347429529 &&
    plugItem.inventory.tierType === TierType.Basic
  ) {
    return false;
  }

  // Remove masterwork mods and energy mods
  if (plugItem.plug.plugCategoryIdentifier.match(/masterworks/)) {
    return false;
  }

  // Remove empty sockets, which are common tier
  if (plugItem.inventory.tierType === TierType.Common) {
    return false;
  }

  // Only real mods
  if (
    !socket.isPerk &&
    (plugItem.inventory.bucketTypeHash !== 3313201758 || !plugItem.inventory.recoveryBucketTypeHash)
  ) {
    return false;
  }

  return true;
}

/**
 * Add a locked item to the locked item list for a bucket.
 */
export function addLockedItem(
  lockedItem: LockedItemType,
  locked: readonly LockedItemType[] = []
): readonly LockedItemType[] | undefined {
  // Locking an item clears out the other locked properties in that bucket
  if (lockedItem.type === 'item') {
    return [lockedItem];
  }

  // there can only be one burn type per bucket
  if (lockedItem.type === 'burn') {
    const newLockedItems = locked.filter((li) => li.type !== 'burn');
    newLockedItems.push(lockedItem);
    return newLockedItems;
  }

  // Only add if it's not already there.
  if (!locked.some((existing) => lockedItemsEqual(existing, lockedItem))) {
    const newLockedItems = Array.from(locked);
    newLockedItems.push(lockedItem);
    return newLockedItems;
  }

  return locked.length === 0 ? undefined : locked;
}

/**
 * Remove a locked item from the locked item list for a bucket.
 */
export function removeLockedItem(
  lockedItem: LockedItemType,
  locked: readonly LockedItemType[] = []
): readonly LockedItemType[] | undefined {
  // Filter anything equal to the passed in item
  const newLockedItems = locked.filter((existing) => !lockedItemsEqual(existing, lockedItem));
  return newLockedItems.length === 0 ? undefined : newLockedItems;
}

export function lockedItemsEqual(first: LockedItemType, second: LockedItemType) {
  switch (first.type) {
    case 'item':
      return second.type === 'item' && first.item.id === second.item.id;
    case 'exclude':
      return second.type === 'exclude' && first.item.id === second.item.id;
    case 'mod':
      return second.type === 'mod' && first.mod.hash === second.mod.hash;
    case 'perk':
      return second.type === 'perk' && first.perk.hash === second.perk.hash;
    case 'burn':
      return second.type === 'burn' && first.burn.dmg === second.burn.dmg;
  }
}

/**
 * filteredPerks:
 * The input perks, filtered down to perks on items that also include the other selected perks in that bucket.
 * For example, if you'd selected "heavy ammo finder" for class items it would only include perks that are on
 * class items that also had "heavy ammo finder".
 *
 * filteredPlugSetHashes:
 * Plug set hashes that contain the mods that can slot into items that can also slot the other selected mods in that bucket.
 * For example, if you'd selected "scout rifle loader" for gauntlets it would only include mods that can slot on
 * gauntlets that can also slot "scout rifle loader".
 */
export function getFilteredPerksAndPlugSets(
  locked: readonly LockedItemType[] | undefined,
  items: readonly DimItem[]
) {
  const filteredPlugSetHashes = new Set<number>();
  const filteredPerks = new Set<DestinyInventoryItemDefinition>();

  if (!locked) {
    return {};
  }

  for (const item of items) {
    // flat list of plugs per item
    const itemPlugs: DestinyInventoryItemDefinition[] = [];
    // flat list of plugSetHashes per item
    const itemPlugSets: number[] = [];

    if (item.isDestiny2() && item.sockets) {
      for (const socket of item.sockets.sockets) {
        // Populate mods
        if (!socket.isPerk) {
          if (socket.socketDefinition.reusablePlugSetHash) {
            itemPlugSets.push(socket.socketDefinition.reusablePlugSetHash);
          } else if (socket.socketDefinition.randomizedPlugSetHash) {
            itemPlugSets.push(socket.socketDefinition.randomizedPlugSetHash);
          }
        }

        // Populate plugs
        if (filterPlugs(socket)) {
          socket.plugOptions.forEach((option) => {
            itemPlugs.push(option.plugItem);
          });
        }
      }
    }

    // The item must be able to slot all mods
    let matches = true;
    for (const lockedItem of locked) {
      if (lockedItem.type === 'mod') {
        const mod = lockedItem.mod;
        if (item.isDestiny2() && matchesEnergy(item, mod)) {
          const plugSetIndex = itemPlugSets.indexOf(lockedItem.plugSetHash);
          if (plugSetIndex >= 0) {
            // Remove this plugSetHash from the list because it is now "occupied"
            itemPlugSets.splice(plugSetIndex, 1);
          } else {
            matches = false;
            break;
          }
        } else {
          matches = false;
          break;
        }
      }
    }

    // for each item, look to see if all perks match locked
    matches =
      matches &&
      locked.every(
        (locked) =>
          locked.type !== 'perk' || itemPlugs.some((plug) => plug.hash === locked.perk.hash)
      );

    // It matches all perks and plugs
    if (matches) {
      for (const plugSetHash of itemPlugSets) {
        filteredPlugSetHashes.add(plugSetHash);
      }
      for (const itemPlug of itemPlugs) {
        filteredPerks.add(itemPlug);
      }
    }
  }

  return { filteredPlugSetHashes, filteredPerks };
}

function matchesEnergy(item: D2Item, mod: DestinyInventoryItemDefinition) {
  return (
    !mod.plug ||
    !mod.plug.energyCost ||
    !item.energy ||
    mod.plug.energyCost.energyType === item.energy.energyType ||
    mod.plug.energyCost.energyType === DestinyEnergyType.Any
  );
}

/**
 * Can this mod be slotted onto this item?
 */
export function canSlotMod(item: DimItem, lockedItem: LockedMod) {
  const mod = lockedItem.mod;
  return (
    item.isDestiny2() &&
    matchesEnergy(item, mod) &&
    // is a seasonal mod and item has correct socket
    (getSpecialtySocketMetadata(item)?.compatiblePlugCategoryHashes.includes(
      lockedItem.mod.plug.plugCategoryHash
    ) ||
      // or matches socket plugsets
      item.sockets?.sockets.some(
        (socket) =>
          (socket.socketDefinition.reusablePlugSetHash &&
            lockedItem.plugSetHash === socket.socketDefinition.reusablePlugSetHash) ||
          (socket.socketDefinition.randomizedPlugSetHash &&
            lockedItem.plugSetHash === socket.socketDefinition.randomizedPlugSetHash)
      ))
  );
}

/** Whether this item is eligible for being in loadout builder */
export function isLoadoutBuilderItem(item: DimItem) {
  // Armor and Ghosts
  return item.bucket.inArmor;
}

export function statTier(stat: number) {
  return Math.floor(stat / 10);
}

/**
 * This is a wrapper for the awkward helper used by
 * GeneratedSetItem#identifyAltPerkChoicesForChosenStats. It figures out which perks need
 * to be selected to get that stat mix.
 *
 * It assumes we're looking for perks, not mixes, and keeps track of what perks are necessary
 * to fulfill a stat-mix, and the callback stops the function early. This is like this
 * so we can share this complicated bit of logic and not get it out of sync.
 */
export function generateMixesFromPerks(
  item: DimItem,
  onMix: (mix: number[], plug: DimPlug[] | null) => boolean
) {
  return generateMixesFromPerksOrStats(item, onMix);
}

/**
 * This is an awkward helper used by both byStatMix (to generate the list of
 * stat mixes) and GeneratedSetItem#identifyAltPerkChoicesForChosenStats. It figures out
 * which perks need to be selected to get that stat mix or in the case of Armour 2.0, it
 * calculates them directly from the stats.
 *
 * It has two modes depending on whether an "onMix" callback is provided - if it is, it
 * assumes we're looking for perks, not mixes, and keeps track of what perks are necessary
 * to fulfill a stat-mix, and lets the callback stop the function early. If not, it just
 * returns all the mixes. This is like this so we can share this complicated bit of logic
 * and not get it out of sync.
 *
 * TODO This is now only used for Armor 1.0 alt perk mixes. It should probably have the
 * stat mix functionality removed and the onMix function merged into this.
 */
function generateMixesFromPerksOrStats(
  item: DimItem,
  /** Callback when a new mix is found. */
  onMix: (mix: number[], plug: DimPlug[] | null) => boolean
) {
  const stats = item.stats;

  if (!stats || stats.length < 3) {
    return [];
  }

  const mixes: number[][] = [getOrderedStatValues(item)];

  const altPerks: (DimPlug[] | null)[] = [null];

  if (stats && item.isDestiny2() && item.sockets && !item.energy) {
    for (const socket of item.sockets.sockets) {
      if (socket.plugOptions.length > 1) {
        for (const plug of socket.plugOptions) {
          if (plug !== socket.plug && plug.stats) {
            // Stats without the currently selected plug, with the optional plug
            const mixNum = mixes.length;
            for (let mixIndex = 0; mixIndex < mixNum; mixIndex++) {
              const existingMix = mixes[mixIndex];
              const optionStat = statValues.map((statHash, index) => {
                const currentPlugValue = (socket.plug?.stats && socket.plug.stats[statHash]) ?? 0;
                const optionPlugValue = plug.stats?.[statHash] || 0;
                return existingMix[index] - currentPlugValue + optionPlugValue;
              });

              const existingMixAlts = altPerks[mixIndex];
              const plugs = existingMixAlts ? [...existingMixAlts, plug] : [plug];
              altPerks.push(plugs);
              if (!onMix(optionStat, plugs)) {
                return [];
              }
              mixes.push(optionStat);
            }
          }
        }
      }
    }
  }

  return mixes;
}

/**
 * This gets stat values for an item ordered by the statValues array.
 */
function getOrderedStatValues(item: DimItem) {
  const stats = _.keyBy(item.stats, (stat) => stat.statHash);
  const keyedStats = {};

  for (const statHash of statValues) {
    keyedStats[statHash] = stats[statHash]?.value || 0;
  }

  // mapping out from stat values to ensure ordering
  return statValues.map((statHash) => keyedStats[statHash]);
}

/**
 * Get the stats totals attributed to locked mods. Note that these are stats from mods in a single bucket, head, arms, ect.
 */
export function getLockedModStats(
  lockedItems?: readonly LockedItemType[],
  lockedArmor2Mods?: readonly LockedArmor2Mod[]
): { [statHash: number]: number } {
  const lockedModStats: { [statHash: number]: number } = {};
  // Handle old armour mods
  if (lockedItems) {
    for (const lockedItem of lockedItems) {
      if (lockedItem.type === 'mod') {
        for (const stat of lockedItem.mod.investmentStats) {
          lockedModStats[stat.statTypeHash] = lockedModStats[stat.statTypeHash] || 0;
          // TODO This is no longer accurate, see https://github.com/DestinyItemManager/DIM/wiki/DIM's-New-Stat-Calculations
          lockedModStats[stat.statTypeHash] += stat.value;
        }
      }
    }
  }

  // Handle armour 2.0 mods
  if (lockedArmor2Mods) {
    for (const lockedMod of lockedArmor2Mods) {
      for (const stat of lockedMod.mod.investmentStats) {
        lockedModStats[stat.statTypeHash] = lockedModStats[stat.statTypeHash] || 0;
        // TODO This is no longer accurate, see https://github.com/DestinyItemManager/DIM/wiki/DIM's-New-Stat-Calculations
        lockedModStats[stat.statTypeHash] += stat.value;
      }
    }
  }

  return lockedModStats;
}
