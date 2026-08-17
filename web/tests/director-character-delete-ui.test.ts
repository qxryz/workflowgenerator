import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const characterPanelSource = readFileSync(
  new URL("../src/director-desk/editor/panels/CharacterPanel.tsx", import.meta.url),
  "utf8",
);
const deleteControlsSource = readFileSync(
  new URL("../src/director-desk/editor/panels/CharacterDeleteControls.tsx", import.meta.url),
  "utf8",
);
const objectTreeSource = readFileSync(
  new URL("../src/director-desk/editor/panels/ObjectTreePanel.tsx", import.meta.url),
  "utf8",
);
const propPanelSource = readFileSync(
  new URL("../src/director-desk/editor/panels/PropPanel.tsx", import.meta.url),
  "utf8",
);
const cameraPanelSource = readFileSync(
  new URL("../src/director-desk/editor/panels/CameraPanel.tsx", import.meta.url),
  "utf8",
);
const selectorsSource = readFileSync(
  new URL("../src/director-desk/editor/store/directorSelectors.ts", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("../src/director-desk/styles/index.css", import.meta.url), "utf8");

test("角色属性面板提供单角色、多选和群众删除入口", () => {
  assert.match(characterPanelSource, /<CharacterDeleteControls \/>/u);
  assert.match(deleteControlsSource, /if \(object\.kind === "character"\) return "角色"/u);
  assert.match(deleteControlsSource, /buttonLabel: `删除\$\{objectLabel\}`/u);
  assert.match(deleteControlsSource, /buttonLabel: `删除所选（\$\{selectedObjects\.length\}）`/u);
  assert.match(deleteControlsSource, /buttonLabel: `删除群众（\$\{crowdMembers\.length\} 个角色）`/u);
  assert.match(deleteControlsSource, /deleteSelectedObject\(\)/u);
});

test("角色删除需要明确二次确认并提供可访问的对话框语义", () => {
  assert.match(deleteControlsSource, /role="alertdialog"/u);
  assert.match(deleteControlsSource, /aria-labelledby=\{confirmationTitleId\}/u);
  assert.match(deleteControlsSource, /aria-describedby=\{confirmationDescriptionId\}/u);
  assert.match(deleteControlsSource, /autoFocus onClick=\{\(\) => setConfirming\(false\)\}/u);
  assert.match(deleteControlsSource, /确认删除/u);
  assert.match(deleteControlsSource, /aria-haspopup="dialog"/u);
});

test("场景树为所有对象提供常驻、可发现的行内删除操作", () => {
  assert.match(objectTreeSource, /const canDeleteFromRow = true/u);
  assert.match(objectTreeSource, /aria-label=\{`删除 \$\{item\.name\}`\}/u);
  assert.match(objectTreeSource, /role="alertdialog"/u);
  assert.match(objectTreeSource, /confirmRowDeletion\(item\)/u);
  assert.match(objectTreeSource, /该机位及其镜头设置会从场景中删除/u);
  assert.match(objectTreeSource, /该模型实例会从场景中删除/u);
  assert.match(objectTreeSource, /该几何体会从场景中删除/u);
  assert.match(objectTreeSource, /点击垃圾桶删除，或选中后按 Delete/u);
  assert.match(objectTreeSource, /setActiveCamera\(item\.object\.linkedCameraId\);[\s\S]*?selectObject\(item\.id\)/u);
  assert.match(styles, /\.object-row \.object-row-delete-button \{[\s\S]*?opacity: 0\.72/u);
  assert.match(styles, /\.object-row:hover \.object-row-delete-button,[\s\S]*?\.object-row:focus-within \.object-row-delete-button/u);
  assert.match(styles, /\.object-row \.object-row-delete-button:focus-visible/u);
});

test("模型、几何体和机位在右侧属性面板也提供统一删除入口", () => {
  assert.match(deleteControlsSource, /if \(object\.kind === "camera"\) return "机位"/u);
  assert.match(deleteControlsSource, /if \(object\.assetRefId\) return "模型"/u);
  assert.match(deleteControlsSource, /return "几何体"/u);
  assert.match(propPanelSource, /<SelectionDeleteControls targetObjectId=\{prop\.id\} \/>/u);
  assert.match(cameraPanelSource, /cameraObjectId \? <SelectionDeleteControls targetObjectId=\{cameraObjectId\} \/>/u);
  assert.match(selectorsSource, /selected\?\.kind === "prop" \|\| selected\?\.geometryType/u);
});
