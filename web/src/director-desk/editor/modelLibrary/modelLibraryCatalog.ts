export type ModelLibraryCategoryId = "my-models";

export type ModelLibraryCategory = {
  directoryName: string;
  id: ModelLibraryCategoryId;
  label: string;
};

export type ModelLibraryItem = {
  categoryId: ModelLibraryCategoryId;
  fileName: string;
  id: string;
  name: string;
  thumbUrl?: string;
  url: string;
};

export const MODEL_LIBRARY_CATEGORIES: ModelLibraryCategory[] = [
  { id: "my-models", label: "我的模型", directoryName: "" },
];

export function getModelLibraryItems(): ModelLibraryItem[] {
  return [];
}
