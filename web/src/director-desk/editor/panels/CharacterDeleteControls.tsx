import { useEffect, useId, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useDirectorStore } from "../store/directorStore";

interface SelectionDeleteControlsProps {
  targetObjectId?: string;
}

function getObjectDeleteLabel(object: { assetRefId?: string | null; kind: string }) {
  if (object.kind === "camera") return "机位";
  if (object.kind === "character") return "角色";
  if (object.assetRefId) return "模型";
  return "几何体";
}

export function SelectionDeleteControls({ targetObjectId }: SelectionDeleteControlsProps = {}) {
  const [confirming, setConfirming] = useState(false);
  const confirmationTitleId = useId();
  const confirmationDescriptionId = useId();
  const objects = useDirectorStore((state) => state.project.objects);
  const selectedObjectId = useDirectorStore((state) => state.selectedObjectId);
  const selectedObjectIds = useDirectorStore((state) => state.selectedObjectIds);
  const selectedCrowdId = useDirectorStore((state) => state.selectedCrowdId);
  const deleteSelectedObject = useDirectorStore((state) => state.deleteSelectedObject);

  const selection = useMemo(() => {
    if (selectedCrowdId) {
      const crowdMembers = objects.filter(
        (item) => item.kind === "character" && item.crowdId === selectedCrowdId,
      );

      if (!crowdMembers.length) return null;

      return {
        signature: `crowd:${selectedCrowdId}:${crowdMembers.map((item) => item.id).join(",")}`,
        buttonLabel: `删除群众（${crowdMembers.length} 个角色）`,
        confirmationTitle: `删除“${crowdMembers[0]?.crowdLabel ?? "群众"}”？`,
        confirmationDescription: `其中的 ${crowdMembers.length} 个角色会一起从场景中删除。`,
      };
    }

    const ids = targetObjectId
      ? [targetObjectId]
      : selectedObjectIds.length
        ? selectedObjectIds
        : selectedObjectId
          ? [selectedObjectId]
          : [];
    const selectedObjects = objects.filter((item) => ids.includes(item.id));
    if (!selectedObjects.length) return null;

    if (selectedObjects.length > 1) {
      return {
        signature: `selection:${selectedObjects.map((item) => item.id).join(",")}`,
        buttonLabel: `删除所选（${selectedObjects.length}）`,
        confirmationTitle: `删除已选的 ${selectedObjects.length} 项内容？`,
        confirmationDescription: "这些内容会一起从场景中删除。",
      };
    }

    const object = selectedObjects[0];
    const objectLabel = getObjectDeleteLabel(object);

    return {
      signature: `object:${object.id}`,
      buttonLabel: `删除${objectLabel}`,
      confirmationTitle: `删除“${object.name}”？`,
      confirmationDescription: `该${objectLabel}会从场景中删除。`,
    };
  }, [objects, selectedCrowdId, selectedObjectId, selectedObjectIds, targetObjectId]);

  useEffect(() => {
    setConfirming(false);
  }, [selection?.signature]);

  if (!selection) return null;

  return (
    <section className="character-delete-section" aria-label="删除场景内容">
      {confirming ? (
        <div
          className="character-delete-confirmation"
          role="alertdialog"
          aria-labelledby={confirmationTitleId}
          aria-describedby={confirmationDescriptionId}
        >
          <div className="character-delete-confirmation-copy">
            <strong id={confirmationTitleId}>{selection.confirmationTitle}</strong>
            <span id={confirmationDescriptionId}>{selection.confirmationDescription}</span>
          </div>
          <div className="character-delete-confirmation-actions">
            <button type="button" autoFocus onClick={() => setConfirming(false)}>
              取消
            </button>
            <button
              className="character-delete-confirm-button"
              type="button"
              onClick={() => {
                if (targetObjectId) {
                  useDirectorStore.getState().selectObject(targetObjectId);
                  useDirectorStore.getState().deleteSelectedObject();
                } else {
                  deleteSelectedObject();
                }
                setConfirming(false);
              }}
            >
              确认删除
            </button>
          </div>
        </div>
      ) : (
        <button
          className="character-delete-button"
          type="button"
          aria-haspopup="dialog"
          onClick={() => setConfirming(true)}
        >
          <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
          <span>{selection.buttonLabel}</span>
        </button>
      )}
    </section>
  );
}

export const CharacterDeleteControls = SelectionDeleteControls;
