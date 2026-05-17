import { getHeaders, MultimodalContent, SupportedEndpoint } from "./api";
import { OpenaiPath, ServiceProvider } from "../constant";
import { DalleQuality, DalleStyle, ModelSize } from "../typing";
import { ChatGPTApi } from "./platforms/openai";
import { fetch } from "../utils/stream";
import { base64Image2Blob, uploadImage } from "../utils/chat";

export type GenerateStudioImageOptions = {
  model: string;
  providerName?: string;
  prompt: string;
  size: ModelSize;
  quality: DalleQuality;
  style: DalleStyle;
};

export type EditStudioImageOptions = GenerateStudioImageOptions & {
  imageUrl?: string;
  imageBlob?: Blob;
};

export type ExpandStudioImageOptions = GenerateStudioImageOptions & {
  imageUrl: string;
};

function getGeneratedImageUrl(content: string | MultimodalContent[]) {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const imageItem = content.find((item) => item.type === "image_url");
  return imageItem?.image_url?.url;
}

export async function generateStudioImage(
  options: GenerateStudioImageOptions,
): Promise<string> {
  const api = new ChatGPTApi();

  return await new Promise<string>((resolve, reject) => {
    api.chat({
      messages: [
        {
          role: "user",
          content: options.prompt,
        },
      ],
      config: {
        model: options.model,
        providerName: options.providerName,
        endpointPath: SupportedEndpoint.ImagesGenerations,
        size: options.size,
        quality: options.quality,
        style: options.style,
        stream: false,
      },
      onFinish(message: string | MultimodalContent[]) {
        const imageUrl = getGeneratedImageUrl(message);

        if (!imageUrl) {
          reject(new Error("模型未返回可展示的图片结果"));
          return;
        }

        resolve(imageUrl);
      },
      onError(error: Error) {
        reject(error);
      },
    });
  });
}

async function fetchImageBlob(imageUrl: string) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error("读取参考图失败");
  }
  return await response.blob();
}

async function resolveEditSourceBlob(options: EditStudioImageOptions) {
  if (options.imageBlob) {
    return options.imageBlob;
  }
  if (options.imageUrl) {
    return await fetchImageBlob(options.imageUrl);
  }
  throw new Error("缺少图像编辑输入");
}

async function uploadB64JsonImage(b64Json: string) {
  return await uploadImage(base64Image2Blob(b64Json, "image/png"));
}

function parseModelSize(size: ModelSize) {
  const [width, height] = size.split("x").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`无效尺寸: ${size}`);
  }
  return { width, height };
}

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("读取图像失败"));
    };
    image.src = objectUrl;
  });
}

async function buildExpandedImageBlob(imageBlob: Blob, size: ModelSize) {
  const sourceImage = await blobToImage(imageBlob);
  const targetSize = parseModelSize(size);
  const canvas = document.createElement("canvas");
  canvas.width = targetSize.width;
  canvas.height = targetSize.height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("初始化扩图画布失败");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  const sourceRatio = sourceImage.width / sourceImage.height;
  const targetRatio = canvas.width / canvas.height;
  let drawWidth = canvas.width;
  let drawHeight = canvas.height;

  if (sourceRatio > targetRatio) {
    drawWidth = Math.min(sourceImage.width, canvas.width * 0.72);
    drawHeight = drawWidth / sourceRatio;
  } else {
    drawHeight = Math.min(sourceImage.height, canvas.height * 0.72);
    drawWidth = drawHeight * sourceRatio;
  }

  const offsetX = (canvas.width - drawWidth) / 2;
  const offsetY = (canvas.height - drawHeight) / 2;
  context.drawImage(sourceImage, offsetX, offsetY, drawWidth, drawHeight);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("生成扩图输入失败"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function buildImageEditPath(providerName?: string) {
  const normalizedProvider = providerName ?? ServiceProvider.OpenAI;
  if (normalizedProvider !== ServiceProvider.OpenAI) {
    throw new Error("当前版本仅支持 OpenAI 兼容图像编辑链路");
  }
  return new ChatGPTApi().path(
    OpenaiPath.ImagePath.replace("generations", "edits"),
  );
}

export async function editStudioImage(
  options: EditStudioImageOptions,
): Promise<string> {
  const imageBlob = await resolveEditSourceBlob(options);
  const requestPath = buildImageEditPath(options.providerName);
  const headers = getHeaders(true, options.providerName);
  delete headers["Content-Type"];

  const formData = new FormData();
  formData.append("model", options.model);
  formData.append("prompt", options.prompt);
  formData.append("image", imageBlob, "reference.png");
  formData.append("size", options.size);
  formData.append("quality", options.quality);
  formData.append("style", options.style);
  formData.append("response_format", "b64_json");
  formData.append("n", "1");

  const response = await fetch(requestPath, {
    method: "POST",
    headers,
    body: formData,
  });
  const responseJson = await response.json();
  const imageUrl = getGeneratedImageUrl([
    {
      type: "image_url",
      image_url: {
        url: responseJson?.data?.at?.(0)?.url ?? "",
      },
    },
  ]);

  if (imageUrl) {
    return imageUrl;
  }

  const b64Json = responseJson?.data?.at?.(0)?.b64_json;
  if (!b64Json) {
    throw new Error(
      responseJson?.error?.message || "模型未返回可展示的编辑结果",
    );
  }

  return await uploadB64JsonImage(b64Json);
}

export async function expandStudioImage(
  options: ExpandStudioImageOptions,
): Promise<string> {
  const sourceBlob = await fetchImageBlob(options.imageUrl);
  const expandedBlob = await buildExpandedImageBlob(sourceBlob, options.size);

  return await editStudioImage({
    ...options,
    imageBlob: expandedBlob,
  });
}
