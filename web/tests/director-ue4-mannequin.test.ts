import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const modelPath = new URL("../public/models/ue-mannequin-retopology.glb", import.meta.url);
const licensePath = new URL("../public/models/ue-mannequin-retopology.license.txt", import.meta.url);
const rigSource = readFileSync(
  new URL("../src/director-desk/editor/runtime/ue4Mannequin/ue4MannequinRig.ts", import.meta.url),
  "utf8",
);

function parseGlbJson(binary: Buffer) {
  assert.equal(binary.toString("ascii", 0, 4), "glTF");

  let offset = 12;
  while (offset < binary.byteLength) {
    const length = binary.readUInt32LE(offset);
    const type = binary.toString("ascii", offset + 4, offset + 8);
    if (type === "JSON") {
      return JSON.parse(binary.toString("utf8", offset + 8, offset + 8 + length).replace(/\0+$/u, "")) as {
        nodes: Array<{ name?: string }>;
        meshes: unknown[];
        skins: unknown[];
      };
    }
    offset += 8 + length;
  }

  throw new Error("GLB 缺少 JSON 数据块");
}

test("bundles the exact upstream rigged mannequin with its separate attribution", () => {
  const binary = readFileSync(modelPath);
  const gltf = parseGlbJson(binary);
  const license = readFileSync(licensePath, "utf8");

  assert.equal(createHash("sha256").update(binary).digest("hex"), "5622c6150467fb96ff70d30eb3393286131c8523feaa3b78f80515d499cb1a14");
  assert.equal(gltf.meshes.length, 1);
  assert.equal(gltf.skins.length, 1);
  assert.ok(gltf.nodes.filter((node) => node.name?.startsWith("Bip001")).length >= 29);
  assert.match(license, /William Luque/u);
  assert.match(license, /SKETCHFAB Standard/u);
  assert.match(license, /5394d9f894374a2ab7c57a21929ce4c2/u);
});

test("maps all eight body variants through the upstream UE skeleton", () => {
  ["female", "broad", "muscular", "slim", "teen", "child", "chibi"].forEach((bodyType) => {
    assert.match(rigSource, new RegExp(`case "${bodyType}"`, "u"));
  });
  Object.values({
    body: "Bip001_Pelvis_03",
    torso: "Bip001_Spine1_05",
    head: "Bip001_Head_055",
    leftHand: "Bip001_L_Hand_010",
    rightHand: "Bip001_R_Hand_034",
    leftFoot: "Bip001_L_Foot_059",
    rightFoot: "Bip001_R_Foot_063",
  }).forEach((boneName) => assert.match(rigSource, new RegExp(boneName, "u")));
  assert.match(rigSource, /scales\.Bip001_Head_055 = \[4, 4, 4\]/u);
  assert.match(rigSource, /case "chibi":[\s\S]*?return \[0\.56, 0\.56, 0\.56\]/u);
});

test("passes the recalibrated wide-angle pose controls to the UE bones without legacy 90-degree clipping", () => {
  assert.match(rigSource, /clampPoseControlValue\(key, controls\[key\] \?\? 0, bodyType\)/u);
  assert.doesNotMatch(rigSource, /getBodyTypePoseLimit/u);
  assert.match(rigSource, /Bip001_L_Forearm_09: ue4LimbBendRotation/u);
  assert.match(rigSource, /Bip001_R_Calf_062: ue4LimbBendRotation/u);
  assert.match(rigSource, /Bip001_L_Foot_059: ue4FootRotation/u);
});

test("uses the UE model for both new and previously saved built-in characters", () => {
  const modelSource = readFileSync(new URL("../src/director-desk/editor/runtime/CharacterModel.tsx", import.meta.url), "utf8");
  const storeSource = readFileSync(new URL("../src/director-desk/editor/store/directorStore.ts", import.meta.url), "utf8");

  assert.match(modelSource, /\["mannequin", "ue4-mannequin"\]\.includes\(rigType\)/u);
  assert.match(modelSource, /<UE4MannequinModel/u);
  assert.match(modelSource, /<PrimitiveMannequin/u);
  assert.match(storeSource, /rigType: "ue4-mannequin"/u);
});
