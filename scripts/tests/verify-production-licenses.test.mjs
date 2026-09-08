import assert from "node:assert/strict";
import test from "node:test";

import { validateLicenseInventory } from "../verify-production-licenses.mjs";

const notice = `
## buffers 0.1.1
License: MIT
Permission is hereby granted
`;

function inventoryFor(metadataException = { name: "buffers", versions: ["0.1.1"] }) {
  return {
    MIT: [{ name: "example", versions: ["1.0.0"] }],
    Unknown: [metadataException],
  };
}

test("production license validation permits only the reviewed inventory and notice", () => {
  assert.doesNotThrow(() => validateLicenseInventory(inventoryFor(), notice));
  assert.throws(
    () => validateLicenseInventory({ ...inventoryFor(), "GPL-3.0": [] }, notice),
    /Unreviewed production license/u,
  );
  assert.throws(
    () => validateLicenseInventory(inventoryFor({ name: "other", versions: ["1.0.0"] }), notice),
    /only approved missing-metadata exception/u,
  );
  assert.throws(
    () => validateLicenseInventory(inventoryFor(), "incomplete"),
    /supplemental MIT notice is incomplete/u,
  );
});
