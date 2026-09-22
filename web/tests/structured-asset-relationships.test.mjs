import assert from "node:assert/strict";
import test from "node:test";
import { synchronizeStructuredAssetRelationships, removeStructuredAssetRelationships } from "../src/lib/structured-asset-relationships.ts";

const asset = (id, relationships = [], kind = "character") => ({ id, kind, title: id.toUpperCase(), coverUrl: "", tags: [], createdAt: "2026-01-01", updatedAt: "2026-01-01", data: { description: "", fields: {}, images: [], relationships } });
const relation = { id: "parent-link", targetAssetId: "b", targetName: "B", label: "父亲" };

test("legacy one-way relationships become mirrored edges without reversing their meaning", () => {
    const result = synchronizeStructuredAssetRelationships([asset("a", [relation]), asset("b")]);
    assert.deepEqual(result[0].data.relationships, [{ ...relation, sourceAssetId: "a", sourceName: "A" }]);
    assert.deepEqual(result[1].data.relationships, [{ ...relation, targetAssetId: "a", targetName: "A", sourceAssetId: "a", sourceName: "A" }]);
    assert.deepEqual(synchronizeStructuredAssetRelationships(result), result);
});

test("edits and removals from the mirrored end synchronize both ends", () => {
    const original = synchronizeStructuredAssetRelationships([asset("a", [relation]), asset("b")]);
    const b = { ...original[1], data: { ...original[1].data, relationships: original[1].data.relationships.map((item) => ({ ...item, label: "养父" })) } };
    const edited = synchronizeStructuredAssetRelationships([original[0], b], "b");
    assert.equal(edited[0].data.relationships[0].label, "养父");
    assert.equal(edited[0].data.relationships[0].sourceAssetId, "a");
    const removed = synchronizeStructuredAssetRelationships([edited[0], asset("b")], "b");
    assert.deepEqual(
        removed.map((item) => item.data.relationships),
        [[], []],
    );
});

test("renames update endpoint snapshots; missing imports survive and deletion removes both ends", () => {
    const missing = synchronizeStructuredAssetRelationships([asset("a", [relation])]);
    assert.equal(missing[0].data.relationships[0].targetName, "B");
    const restored = synchronizeStructuredAssetRelationships([...missing, asset("b")]);
    const renamed = synchronizeStructuredAssetRelationships([{ ...restored[0], title: "父亲角色" }, restored[1]], "a");
    assert.equal(renamed[1].data.relationships[0].targetName, "父亲角色");
    assert.equal(renamed[1].data.relationships[0].sourceName, "父亲角色");
    const [remaining] = removeStructuredAssetRelationships(renamed, "a");
    assert.deepEqual(remaining.data.relationships, []);
    assert.ok(remaining.updatedAt > renamed[1].updatedAt);
});

test("scene links mirror independently and duplicate legacy pair entries reconcile consistently", () => {
    const result = synchronizeStructuredAssetRelationships([asset("a", [relation], "scene"), asset("b", [{ id: "old-reverse", targetAssetId: "a", targetName: "A", label: "旧关系" }], "scene")], "a");
    assert.equal(result[1].data.relationships.length, 1);
    assert.equal(result[1].data.relationships[0].id, "parent-link");
    assert.equal(result[1].data.relationships[0].label, "父亲");
});

test("mirrored updates carry the edit timestamp for sync while passive normalization stays stable", () => {
    const original = synchronizeStructuredAssetRelationships([asset("a", [relation]), asset("b")]);
    const edited = { ...original[0], updatedAt: "2026-09-15", data: { ...original[0].data, relationships: original[0].data.relationships.map((item) => ({ ...item, label: "养父" })) } };
    const result = synchronizeStructuredAssetRelationships([edited, original[1]], "a");
    assert.equal(result[1].updatedAt, edited.updatedAt);
    assert.deepEqual(synchronizeStructuredAssetRelationships(result), result);
});
