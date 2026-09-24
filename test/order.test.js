const { test } = require("node:test")
const assert = require("node:assert/strict")
const { sortByPublishOrder } = require("../src/publishing/order")

const tiers = [["nice-styles", "nice-icons"], ["nice-react-styles"], ["nice-react-flex"]]

test("tier-0 packages sort first", () => {
  const sorted = sortByPublishOrder(
    [{ name: "nice-react-flex" }, { name: "nice-react-styles" }, { name: "nice-styles" }],
    tiers
  )
  assert.deepEqual(sorted.map(p => p.name), ["nice-styles", "nice-react-styles", "nice-react-flex"])
})

test("unregistered packages sort after every tier", () => {
  const sorted = sortByPublishOrder([{ name: "nice-unknown" }, { name: "nice-icons" }], tiers)
  assert.deepEqual(sorted.map(p => p.name), ["nice-icons", "nice-unknown"])
})
