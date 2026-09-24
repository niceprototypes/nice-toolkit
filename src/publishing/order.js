/**
 * @fileoverview Publish ordering
 *
 * Sorts publish candidates by their registry tier so a dependency is built
 * and released before every package that depends on it.
 *
 * @module publisher/order
 */

/**
 * Tier assigned to a package that is not in the registry, so it sorts after
 * every registered tier.
 * @constant {number}
 */
const UNKNOWN_ORDER = 99

/**
 * Sorts packages in place by tier order.
 *
 * Tier 0 is a valid index, so the unknown-package fallback uses `??`: with
 * `||` a tier-0 package (nice-styles, nice-icons, …) would read as
 * UNKNOWN_ORDER and sort last.
 *
 * @param {{ name: string }[]} packages - Packages to sort (mutated)
 * @param {string[][]} tiers - Package names grouped by tier, bottom to top
 * @returns {{ name: string }[]} The same array, sorted
 */
function sortByPublishOrder(packages, tiers) {
  const orderMap = new Map()
  tiers.forEach((tier, tierIndex) => {
    for (const name of tier) orderMap.set(name, tierIndex)
  })
  return packages.sort(
    (a, b) => (orderMap.get(a.name) ?? UNKNOWN_ORDER) - (orderMap.get(b.name) ?? UNKNOWN_ORDER)
  )
}

module.exports = { sortByPublishOrder, UNKNOWN_ORDER }
