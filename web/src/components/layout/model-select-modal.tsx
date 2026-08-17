import { App, Button, Checkbox, Input, Modal, Tabs } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchChannelModels } from "@/services/api/image";
import { getProviderDefinition } from "@/lib/model-providers";
import { catalogModelsForVendor, getModelVendor, legacyVendorForApiFormat, recommendedCatalogModelsForVendor, type VendorId } from "@/lib/model-catalog";
import { miniMaxCredentialError } from "@/lib/minimax-contract";
import type { ModelChannel } from "@/stores/use-config-store";

// 按来源展示当前供应商的推荐、目录、接口返回和已添加模型。
type ModelSourceTab = "recommended" | "catalog" | "remote" | "existing";

export function ModelSelectModal({ open, channel, selectedNames, onConfirm, onClose }: { open: boolean; channel: ModelChannel | null; selectedNames: string[]; onConfirm: (names: string[]) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const [existing, setExisting] = useState<string[]>([]);
    const [fetched, setFetched] = useState<string[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState<ModelSourceTab>("recommended");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const provider = channel ? getProviderDefinition(channel.apiFormat) : null;
    const vendorId = channel ? ((channel.vendor as VendorId) || legacyVendorForApiFormat(channel.apiFormat)) : null;
    const vendor = vendorId ? getModelVendor(vendorId) : null;
    const catalogModels = vendorId ? catalogModelsForVendor(vendorId).map((model) => model.name) : provider?.presets.map((preset) => preset.name) || [];
    const recommendedModels = vendorId ? recommendedCatalogModelsForVendor(vendorId).map((model) => model.name) : catalogModels;
    const availableNames = useMemo(() => Array.from(new Set([...existing, ...recommendedModels, ...catalogModels, ...fetched])), [catalogModels, existing, fetched, recommendedModels]);

    useEffect(() => {
        if (!open) return;
        const allowedExisting = channel ? selectedNames.filter((name) => channel.models.some((model) => model.name === name && (!model.provider || model.provider === channel.apiFormat))) : [];
        setExisting(allowedExisting);
        setFetched([]);
        setSelected(new Set(allowedExisting));
        setActiveTab(recommendedModels.length ? "recommended" : allowedExisting.length ? "existing" : "remote");
        setSearch("");
    }, [channel, open, recommendedModels.length, selectedNames]);

    const currentList = activeTab === "recommended" ? recommendedModels : activeTab === "catalog" ? catalogModels : activeTab === "remote" ? fetched : existing;
    const visibleList = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return keyword ? currentList.filter((name) => name.toLowerCase().includes(keyword)) : currentList;
    }, [currentList, search]);
    const visibleSelectedCount = visibleList.filter((name) => selected.has(name)).length;

    const toggle = (name: string, checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(name);
            else next.delete(name);
            return next;
        });

    const selectVisible = (checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            visibleList.forEach((name) => (checked ? next.add(name) : next.delete(name)));
            return next;
        });

    const fetchModels = async () => {
        if (!channel) return;
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error(`请先填写接口地址和${vendorId === "minimax-token-plan" ? " Token Plan Key" : " API Key"}`);
            return;
        }
        const credentialError = vendorId === "minimax-token-plan" ? miniMaxCredentialError("token-plan", channel.apiKey) : vendorId === "minimax-api" ? miniMaxCredentialError("payg", channel.apiKey) : "";
        if (credentialError) {
            message.error(credentialError);
            return;
        }
        setLoading(true);
        try {
            const models = await fetchChannelModels(channel);
            setFetched(Array.from(new Set(models)));
            setActiveTab("remote");
            message.success(`已读取 ${models.length} 个接口返回模型`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "拉取模型失败");
        } finally {
            setLoading(false);
        }
    };

    const confirm = () => {
        const ordered = [...existing, ...recommendedModels, ...catalogModels, ...fetched].filter((name, index, list) => list.indexOf(name) === index).filter((name) => selected.has(name));
        onConfirm(ordered);
        onClose();
    };

    return (
        <Modal
            open={open}
            width={880}
            centered
            onCancel={onClose}
            title={
                <span>
                    选择渠道模型{" "}
                    <span className="ml-2 text-xs font-normal text-stone-500">
                        已选择 {selected.size} / {availableNames.length}
                    </span>
                </span>
            }
            styles={{ body: { maxHeight: "62vh", overflowY: "auto" } }}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    取消
                </Button>,
                <Button key="confirm" type="primary" onClick={confirm}>
                    确定
                </Button>,
            ]}
        >
            <div className="flex flex-wrap items-center gap-3">
                <Input className="min-w-[200px] flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模型" prefix={<Search className="size-4 text-stone-400" />} allowClear />
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void fetchModels()}>
                    从 {vendor?.label || provider?.label || "当前供应商"} 拉取
                </Button>
            </div>
            <div className="mt-2 text-xs text-stone-500">推荐、内置目录和当前渠道接口返回结果分开显示，模型来源一目了然。</div>
            <Tabs
                className="mt-3"
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ModelSourceTab)}
                items={[
                    { key: "recommended", label: `推荐模型 (${recommendedModels.length})` },
                    { key: "catalog", label: `模型目录 (${catalogModels.length})` },
                    { key: "remote", label: `接口返回 (${fetched.length})` },
                    { key: "existing", label: `已添加 (${existing.length})` },
                ]}
            />

            <div className="mb-3 text-xs text-stone-500">
                {activeTab === "recommended"
                    ? "精选已完成工作台适配的代表模型。"
                    : activeTab === "catalog"
                      ? "应用内置的当前厂商模型目录，不代表当前 Key 一定有调用权限。"
                      : activeTab === "remote"
                        ? "本次从当前渠道接口实际读取的模型；重新拉取会刷新此列表。"
                        : "已经添加到当前渠道的模型。"}
            </div>

            <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs text-stone-500">
                    当前列表已选择 {visibleSelectedCount} / {visibleList.length}
                </span>
                <div className="flex gap-2">
                    <Button size="small" disabled={!visibleList.length} onClick={() => selectVisible(true)}>
                        全选当前列表
                    </Button>
                    <Button size="small" disabled={!visibleSelectedCount} onClick={() => selectVisible(false)}>
                        取消当前列表
                    </Button>
                </div>
            </div>

            {visibleList.length ? (
                <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
                    {visibleList.map((name) => (
                        <Checkbox key={name} checked={selected.has(name)} onChange={(event) => toggle(name, event.target.checked)}>
                            <span className="truncate" title={name}>
                                {name}
                            </span>
                        </Checkbox>
                    ))}
                </div>
            ) : (
                <div className="py-8 text-center text-sm text-stone-500">
                    {activeTab === "remote" ? "尚未从接口拉取模型，点击右上角的拉取按钮即可读取。" : activeTab === "existing" ? "当前渠道还没有添加模型。" : "当前来源暂无模型。"}
                </div>
            )}
        </Modal>
    );
}
