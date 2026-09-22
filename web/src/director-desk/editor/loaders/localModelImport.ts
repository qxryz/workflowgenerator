const LOCAL_MODEL_EXTENSION_RE = /\.(fbx|obj)$/i;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("模型文件读取失败"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("模型文件读取失败")));
    reader.readAsDataURL(file);
  });
}

export async function readLocalModelFile(file: File) {
  if (!LOCAL_MODEL_EXTENSION_RE.test(file.name)) {
    throw new Error("当前仅支持 FBX / OBJ 模型文件");
  }

  return {
    id: crypto.randomUUID(),
    fileName: file.name,
    name: file.name.replace(LOCAL_MODEL_EXTENSION_RE, ""),
    url: await readFileAsDataUrl(file),
  };
}
