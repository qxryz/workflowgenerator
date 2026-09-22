import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Material } from "three";

const webRoot = process.cwd();
const sceneRootPath = path.join(webRoot, "src/director-desk/editor/canvas/SceneRoot.tsx");
const sceneRootSource = readFileSync(sceneRootPath, "utf8");
const toolbarSource = readFileSync(
    new URL("../src/director-desk/editor/canvas/ViewportToolbar.tsx", import.meta.url),
    "utf8",
);

async function loadImportedModelMaterialHelpers() {
    const bundle = await build({
        stdin: {
            contents: `export { applyImportedObjectColor, cloneImportedObjectWithIsolatedMaterials } from ${JSON.stringify(sceneRootPath)};`,
            resolveDir: webRoot,
            sourcefile: "director-import-materials-entry.ts",
        },
        bundle: true,
        format: "esm",
        logLevel: "silent",
        platform: "node",
        treeShaking: true,
        write: false,
    });
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
    return import(moduleUrl);
}

test("Director model and panorama imports report clear accessible outcomes", () => {
    assert.match(toolbarSource, /role=\{importNotice\.kind === "error" \? "alert" : "status"\}/u);
    assert.match(toolbarSource, /aria-live=\{importNotice\.kind === "error" \? "assertive" : "polite"\}/u);
    assert.match(toolbarSource, /已将\$\{subject\}\$\{destination\}/u);
    assert.match(toolbarSource, /模型导入失败，请换一个 FBX 或 OBJ 文件重试/u);
    assert.match(toolbarSource, /已导入全景图/u);
    assert.match(toolbarSource, /全景图导入失败，请换一张 JPG、PNG 或 WEBP 图片重试/u);
    assert.doesNotMatch(toolbarSource, /keeps file actions quiet|detailed import feedback lives in the side panel/u);
});

test("imported model tint uses isolated materials and can restore source colors", async () => {
    assert.match(sceneRootSource, /<ImportedModel color=\{item\.color\} fileName=\{asset\.fileName\}/u);
    assert.match(sceneRootSource, /useEffect\(\(\) => \(\) => disposeImportedObjectMaterials\(clone\), \[clone\]\)/u);

    const { applyImportedObjectColor, cloneImportedObjectWithIsolatedMaterials } =
        await loadImportedModelMaterialHelpers();
    const sharedMaterial = new MeshStandardMaterial({ color: "#234567" });
    const accentMaterial = new MeshStandardMaterial({ color: "#abcdef" });
    const geometry = new BoxGeometry(1, 1, 1);
    const source = new Group();
    source.add(new Mesh(geometry, sharedMaterial));
    source.add(new Mesh(geometry, [sharedMaterial, accentMaterial]));

    const isolated = cloneImportedObjectWithIsolatedMaterials(source);
    const firstClone = isolated.object.children[0] as Mesh;
    const secondClone = isolated.object.children[1] as Mesh;
    const firstCloneMaterial = firstClone.material as MeshStandardMaterial;
    const secondCloneMaterials = secondClone.material as Material[];

    assert.notEqual(firstCloneMaterial, sharedMaterial);
    assert.equal(firstCloneMaterial, secondCloneMaterials[0]);
    assert.notEqual(secondCloneMaterials[1], accentMaterial);

    applyImportedObjectColor(isolated.object, isolated.originalColors, "#ff3366");
    assert.equal(firstCloneMaterial.color.getHexString(), "ff3366");
    assert.equal((secondCloneMaterials[1] as MeshStandardMaterial).color.getHexString(), "ff3366");
    assert.equal(sharedMaterial.color.getHexString(), "234567");
    assert.equal(accentMaterial.color.getHexString(), "abcdef");

    applyImportedObjectColor(isolated.object, isolated.originalColors);
    assert.equal(firstCloneMaterial.color.getHexString(), "234567");
    assert.equal((secondCloneMaterials[1] as MeshStandardMaterial).color.getHexString(), "abcdef");

    geometry.dispose();
    sharedMaterial.dispose();
    accentMaterial.dispose();
    firstCloneMaterial.dispose();
    secondCloneMaterials.forEach((material) => {
        if (material !== firstCloneMaterial) material.dispose();
    });
});
