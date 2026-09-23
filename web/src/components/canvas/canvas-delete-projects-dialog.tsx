import { useState } from "react";
import { App, Button, Modal } from "antd";

import { deleteCanvasProjects } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const { message } = App.useApp();
    const [deleting, setDeleting] = useState(false);
    const confirm = async () => {
        setDeleting(true);
        try { await deleteCanvasProjects(ids); removeSelectedIds(ids); setDeleteIds([]); message.success("画布及关联记录已删除"); }
        catch (error) { message.error(error instanceof Error ? error.message : "删除失败，请重试"); }
        finally { setDeleting(false); }
    };

    return (
        <Modal
            title="删除画布？"
            open={ids.length > 0}
            centered
            onCancel={() => { if (!deleting) setDeleteIds([]); }}
            footer={
                <>
                    <Button disabled={deleting} onClick={() => setDeleteIds([])}>取消</Button>
                    <Button danger type="primary" loading={deleting} onClick={() => void confirm()}>
                        删除
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">将删除 {ids.length} 个画布，以及相关会话（含归档）、计划、运行记录和工作文件。其他画布或素材库仍在使用的媒体会保留。此操作无法撤销。</p>
        </Modal>
    );
}
