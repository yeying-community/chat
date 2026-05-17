import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";

import {
  editStudioImage,
  expandStudioImage,
  generateStudioImage,
} from "../client/image-studio";
import {
  LLMModel,
  supportsImageEditEndpoint,
  supportsImageGenerationEndpoint,
} from "../client/api";
import ImageIcon from "../icons/image.svg";
import { useChatStore } from "../store";
import { ChatSession } from "../store/chat";
import {
  ImageStudioAction,
  ImageStudioAsset,
  ImageStudioBackground,
  ImageStudioWorkspace,
} from "../store/image-studio";
import { DalleQuality, DalleStyle, ModelSize } from "../typing";
import { useImageStudioWorkspace, useSessionModels } from "../utils/hooks";
import { normalizeModelCandidates } from "../utils/model";
import { uploadImage } from "../utils/chat";

import styles from "./image-studio.module.scss";

type StageSize = {
  width: number;
  height: number;
};

const MIN_STAGE_WIDTH = 320;
const MIN_STAGE_HEIGHT = 280;

function useStageSize(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [stageSize, setStageSize] = useState<StageSize>({
    width: MIN_STAGE_WIDTH,
    height: MIN_STAGE_HEIGHT,
  });

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const updateStageSize = () => {
      setStageSize({
        width: Math.max(container.clientWidth, MIN_STAGE_WIDTH),
        height: Math.max(container.clientHeight, MIN_STAGE_HEIGHT),
      });
    };

    updateStageSize();

    const observer = new ResizeObserver(() => {
      updateStageSize();
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, [containerRef]);

  return stageSize;
}

function useCanvasImage(url?: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string>();

  useEffect(() => {
    if (!url) {
      return;
    }

    const nextImage = new window.Image();
    nextImage.crossOrigin = "anonymous";
    nextImage.onload = () => {
      setImage(nextImage);
      setLoadedUrl(url);
    };
    nextImage.onerror = () => undefined;
    nextImage.src = url;
  }, [url]);

  if (!url || loadedUrl !== url) {
    return null;
  }

  return image;
}

function getStatusLabel(status: ImageStudioAsset["status"]) {
  switch (status) {
    case "running":
      return "生成中";
    case "ready":
      return "已完成";
    case "error":
      return "失败";
    default:
      return "待生成";
  }
}

function getActionLabel(action: ImageStudioAction) {
  switch (action) {
    case "edit":
      return "编辑";
    case "expand":
      return "扩图";
    default:
      return "生成";
  }
}

function resolveSelectedAsset(workspace: ImageStudioWorkspace) {
  return workspace.assets.find(
    (asset) => asset.id === workspace.selectedAssetId,
  );
}

function resolveAssetByKind(
  workspace: ImageStudioWorkspace,
  kind: ImageStudioAsset["kind"],
) {
  return workspace.assets.find((asset) => asset.kind === kind);
}

function isImageModel(model: LLMModel) {
  return supportsImageGenerationEndpoint(model.supportedEndpoints);
}

function isImageEditModel(model: LLMModel) {
  return supportsImageEditEndpoint(model.supportedEndpoints);
}

export function ImageStudio(props: { session: ChatSession }) {
  const chatStore = useChatStore();
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const stageSize = useStageSize(stageContainerRef);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingReference, setIsUploadingReference] = useState(false);
  const currentModel = props.session.mask.modelConfig.model || "gpt-image-2";
  const sessionCandidateModels = useMemo(
    () => normalizeModelCandidates(props.session.mask.candidateModels),
    [props.session.mask.candidateModels],
  );
  const runtimeModels = useSessionModels(sessionCandidateModels);
  const imageModels = useMemo(
    () => runtimeModels.filter((model) => isImageModel(model)),
    [runtimeModels],
  );
  const imageEditModels = useMemo(
    () => runtimeModels.filter((model) => isImageEditModel(model)),
    [runtimeModels],
  );
  const defaults = useMemo(
    () => ({
      prompt: props.session.topic === "图像工作空间" ? "" : props.session.topic,
      size: props.session.mask.modelConfig.size ?? ("1024x1024" as ModelSize),
      quality:
        props.session.mask.modelConfig.quality ?? ("standard" as DalleQuality),
      style: props.session.mask.modelConfig.style ?? ("vivid" as DalleStyle),
    }),
    [
      props.session.mask.modelConfig.quality,
      props.session.mask.modelConfig.size,
      props.session.mask.modelConfig.style,
      props.session.topic,
    ],
  );
  const { workspace, update: updateWorkspace } = useImageStudioWorkspace(
    props.session.id,
    defaults,
  );
  const selectedAsset = workspace ? resolveSelectedAsset(workspace) : undefined;
  const canvasImage = useCanvasImage(selectedAsset?.imageUrl);

  if (!workspace) {
    return null;
  }

  const currentRuntimeModel = imageModels.find(
    (model) =>
      model.name === props.session.mask.modelConfig.model &&
      model.provider?.providerName ===
        props.session.mask.modelConfig.providerName,
  );

  const resultAsset = resolveAssetByKind(workspace, "result");
  const referenceAsset = resolveAssetByKind(workspace, "reference");
  const actionLabel = getActionLabel(workspace.action);
  const isGenerate = workspace.action === "generate";
  const isEdit = workspace.action === "edit";
  const isExpand = workspace.action === "expand";

  const ensureRunnableAsset = () => {
    const runningAssetId = resultAsset?.id;

    updateWorkspace((draft) => {
      const asset = draft.assets.find((item) => item.id === runningAssetId);

      if (!asset) {
        return;
      }

      asset.status = "running";
      asset.errorMessage = undefined;
      asset.imageUrl = undefined;
      draft.lastError = undefined;
    });

    return runningAssetId;
  };

  const runGenerate = async () => {
    if (workspace.prompt.trim().length === 0) {
      updateWorkspace((draft) => {
        draft.lastError = "请输入图像描述后再执行生成";
      });
      return;
    }

    if (!currentRuntimeModel) {
      updateWorkspace((draft) => {
        draft.lastError =
          "当前模型不支持图像生成，请在下方选择一个运行时可用的生图模型";
      });
      return;
    }

    const requiresEditModel =
      workspace.action === "edit" || workspace.action === "expand";
    if (workspace.action === "edit" && !referenceAsset?.imageUrl) {
      updateWorkspace((draft) => {
        draft.lastError = "请先上传参考图，再执行图像编辑";
      });
      return;
    }

    if (requiresEditModel) {
      const currentEditModel = imageEditModels.find(
        (model) =>
          model.name === props.session.mask.modelConfig.model &&
          model.provider?.providerName ===
            props.session.mask.modelConfig.providerName,
      );
      if (!currentEditModel) {
        updateWorkspace((draft) => {
          draft.lastError =
            workspace.action === "edit"
              ? "当前模型不支持图像编辑，请切换到声明支持 /v1/images/edits 的模型"
              : "当前模型不支持扩图所需的图像编辑链路，请切换到声明支持 /v1/images/edits 的模型";
        });
        return;
      }
    }

    if (workspace.action === "expand" && !selectedAsset?.imageUrl) {
      updateWorkspace((draft) => {
        draft.lastError = "请先选择一张已有图片，再执行扩图";
      });
      return;
    }

    const runningAssetId = ensureRunnableAsset();
    if (!runningAssetId) {
      return;
    }

    setIsSubmitting(true);

    try {
      const imageUrl =
        workspace.action === "edit" && referenceAsset?.imageUrl
          ? await editStudioImage({
              model: props.session.mask.modelConfig.model,
              providerName: props.session.mask.modelConfig.providerName,
              prompt: workspace.prompt,
              size: workspace.size,
              quality: workspace.quality,
              style: workspace.style,
              imageUrl: referenceAsset.imageUrl,
            })
          : workspace.action === "expand" && selectedAsset?.imageUrl
            ? await expandStudioImage({
                model: props.session.mask.modelConfig.model,
                providerName: props.session.mask.modelConfig.providerName,
                prompt: workspace.prompt,
                size: workspace.size,
                quality: workspace.quality,
                style: workspace.style,
                imageUrl: selectedAsset.imageUrl,
              })
            : await generateStudioImage({
                model: props.session.mask.modelConfig.model,
                providerName: props.session.mask.modelConfig.providerName,
                prompt: workspace.prompt,
                size: workspace.size,
                quality: workspace.quality,
                style: workspace.style,
              });

      updateWorkspace((draft) => {
        const asset = draft.assets.find((item) => item.id === runningAssetId);
        if (!asset) {
          return;
        }

        asset.status = "ready";
        asset.imageUrl = imageUrl;
        asset.errorMessage = undefined;
        asset.title =
          workspace.action === "edit"
            ? "最新编辑结果"
            : workspace.action === "expand"
              ? "最新扩图结果"
              : "最新结果";
        draft.selectedAssetId = asset.id;
        draft.lastError = undefined;
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "图像生成失败，请稍后重试";
      updateWorkspace((draft) => {
        const asset = draft.assets.find((item) => item.id === runningAssetId);
        if (asset) {
          asset.status = "error";
          asset.errorMessage = message;
        }
        draft.lastError = message;
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const uploadReferenceAsset = async () => {
    const file = await new Promise<File | undefined>((resolve) => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept =
        "image/png,image/jpeg,image/webp,image/heic,image/heif";
      fileInput.onchange = (event: Event) => {
        const target = event.target as HTMLInputElement;
        resolve(target.files?.[0]);
      };
      fileInput.click();
    });

    if (!file || !referenceAsset) {
      return;
    }

    setIsUploadingReference(true);

    updateWorkspace((draft) => {
      const asset = draft.assets.find((item) => item.id === referenceAsset.id);
      if (!asset) {
        return;
      }
      asset.status = "running";
      asset.errorMessage = undefined;
      draft.lastError = undefined;
    });

    try {
      const imageUrl = await uploadImage(file);
      updateWorkspace((draft) => {
        const asset = draft.assets.find(
          (item) => item.id === referenceAsset.id,
        );
        if (!asset) {
          return;
        }
        asset.status = "ready";
        asset.imageUrl = imageUrl;
        asset.title = file.name || "参考图";
        asset.errorMessage = undefined;
        draft.selectedAssetId = asset.id;
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "参考图上传失败，请稍后重试";
      updateWorkspace((draft) => {
        const asset = draft.assets.find(
          (item) => item.id === referenceAsset.id,
        );
        if (asset) {
          asset.status = "error";
          asset.errorMessage = message;
        }
        draft.lastError = message;
      });
    } finally {
      setIsUploadingReference(false);
    }
  };

  const setAction = (action: ImageStudioAction) => {
    updateWorkspace((draft) => {
      draft.action = action;
    });
  };

  const setBackground = (background: ImageStudioBackground) => {
    updateWorkspace((draft) => {
      draft.background = background;
    });
  };

  const updateField = <K extends keyof ImageStudioWorkspace>(
    key: K,
    value: ImageStudioWorkspace[K],
  ) => {
    updateWorkspace((draft) => {
      draft[key] = value;
    });
  };

  return (
    <div className={styles["studio"]}>
      <aside className={styles["rail"]}>
        <div className={styles["panel-title"]}>工作空间</div>
        <div className={styles["summary-card"]}>
          <div className={styles["summary-title"]}>图像工作空间</div>
          <div className={styles["summary-meta"]}>
            <span className={styles["summary-line"]}>
              {props.session.topic}
            </span>
            <span className={styles["summary-line"]}>
              {currentRuntimeModel?.displayName ?? currentModel}
            </span>
          </div>
        </div>
        <div className={styles["asset-list"]}>
          {workspace.assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className={styles["asset-item"]}
              data-selected={workspace.selectedAssetId === asset.id}
              onClick={() =>
                updateWorkspace((draft) => {
                  draft.selectedAssetId = asset.id;
                })
              }
            >
              <span className={styles["asset-name"]}>{asset.title}</span>
              <span className={styles["asset-status"]}>
                {getStatusLabel(asset.status)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className={styles["canvas-area"]}>
        <div className={styles["canvas-header"]}>
          <div className={styles["canvas-header-top"]}>
            <div className={styles["canvas-title"]}>
              <ImageIcon />
              <span>图像工作区</span>
            </div>
            <div className={styles["action-toolbar"]}>
              <button
                className={styles["action-button"]}
                data-active={workspace.action === "generate"}
                type="button"
                onClick={() => setAction("generate")}
              >
                生成
              </button>
              <button
                className={styles["action-button"]}
                data-active={workspace.action === "edit"}
                type="button"
                onClick={() => setAction("edit")}
              >
                编辑
              </button>
              <button
                className={styles["action-button"]}
                data-active={workspace.action === "expand"}
                type="button"
                onClick={() => setAction("expand")}
              >
                扩图
              </button>
            </div>
          </div>
        </div>
        <div className={styles["canvas-frame"]} ref={stageContainerRef}>
          <Stage width={stageSize.width} height={stageSize.height}>
            <Layer>
              <Rect
                x={0}
                y={0}
                width={stageSize.width}
                height={stageSize.height}
                fill="#f5f0e8"
              />
              <Rect
                x={24}
                y={24}
                width={Math.max(stageSize.width - 48, 120)}
                height={Math.max(stageSize.height - 48, 120)}
                cornerRadius={24}
                fill="#fffdf8"
                stroke="#d9c8aa"
                strokeWidth={1}
                dash={[8, 8]}
              />
              {canvasImage ? (
                <KonvaImage
                  image={canvasImage}
                  x={40}
                  y={40}
                  width={stageSize.width - 80}
                  height={stageSize.height - 80}
                  cornerRadius={20}
                />
              ) : (
                <>
                  <Text
                    x={48}
                    y={56}
                    text={workspace.prompt || "等待输入图像描述"}
                    fontSize={24}
                    fontStyle="bold"
                    fill="#57391f"
                  />
                  <Text
                    x={48}
                    y={96}
                    width={Math.max(stageSize.width - 96, 120)}
                    text={`${actionLabel} ｜ ${workspace.size}`}
                    fontSize={16}
                    lineHeight={1.5}
                    fill="#7b6146"
                  />
                </>
              )}
            </Layer>
          </Stage>
        </div>
      </main>

      <aside className={styles["inspector"]}>
        <div className={styles["config-group"]}>
          <div className={styles["config-label"]}>提示词</div>
          <textarea
            className={styles["text-area"]}
            value={workspace.prompt}
            placeholder={
              isGenerate
                ? "输入你要生成的图像描述"
                : isEdit
                  ? "输入你希望如何修改参考图"
                  : "输入你希望向外补全的画面描述"
            }
            onChange={(event) =>
              updateField("prompt", event.currentTarget.value)
            }
          />
        </div>

        <div className={styles["status-bar"]}>
          <span>{actionLabel}</span>
          <span>
            {resultAsset?.status
              ? getStatusLabel(resultAsset.status)
              : "待生成"}
          </span>
        </div>

        <div className={styles["config-group"]}>
          <div className={styles["config-label"]}>模型</div>
          <label className={styles["field"]}>
            <span>{isGenerate ? "生图模型" : "模型"}</span>
            <select
              value={`${props.session.mask.modelConfig.model}@${props.session.mask.modelConfig.providerName}`}
              onChange={(event) => {
                const [modelName, providerName] =
                  event.currentTarget.value.split(/@(?!.*@)/);
                chatStore.updateTargetSession(props.session, (draft) => {
                  draft.mask.modelConfig.model = modelName;
                  draft.mask.modelConfig.providerName = providerName as any;
                });
              }}
            >
              {(isGenerate ? imageModels : imageEditModels).map((model) => (
                <option
                  key={`${model.name}@${model.provider?.providerName}`}
                  value={`${model.name}@${model.provider?.providerName}`}
                >
                  {model.displayName ?? model.name}
                  {model.provider?.providerName
                    ? ` (${model.provider.providerName})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {isGenerate && imageModels.length === 0 && (
            <div className={styles["warning-text"]}>
              当前运行时没有可用的生图模型，无法执行图像工作空间操作。
            </div>
          )}
          {!isGenerate && imageEditModels.length === 0 && (
            <div className={styles["warning-text"]}>
              {isEdit
                ? "当前运行时没有声明支持图像编辑的模型，无法执行编辑操作。"
                : "扩图当前基于图像编辑链路实现，因此也需要声明支持图像编辑的模型。"}
            </div>
          )}
        </div>

        <div className={styles["config-group"]}>
          <div className={styles["config-label"]}>输出参数</div>
          <div className={styles["field-grid"]}>
            <label className={styles["field"]}>
              <span>尺寸</span>
              <select
                value={workspace.size}
                onChange={(event) =>
                  updateField("size", event.currentTarget.value as ModelSize)
                }
              >
                {[
                  "1024x1024",
                  "1792x1024",
                  "1024x1792",
                  "768x1344",
                  "864x1152",
                  "1344x768",
                  "1152x864",
                  "1440x720",
                  "720x1440",
                ].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles["field"]}>
              <span>质量</span>
              <select
                value={workspace.quality}
                onChange={(event) =>
                  updateField(
                    "quality",
                    event.currentTarget.value as DalleQuality,
                  )
                }
              >
                <option value="standard">standard</option>
                <option value="hd">hd</option>
              </select>
            </label>
            {!isExpand && (
              <label className={styles["field"]}>
                <span>风格</span>
                <select
                  value={workspace.style}
                  onChange={(event) =>
                    updateField(
                      "style",
                      event.currentTarget.value as DalleStyle,
                    )
                  }
                >
                  <option value="vivid">vivid</option>
                  <option value="natural">natural</option>
                </select>
              </label>
            )}
          </div>
        </div>

        {isGenerate && (
          <div className={styles["config-group"]}>
            <div className={styles["config-label"]}>背景</div>
            <div className={styles["segmented"]}>
              {(
                ["auto", "transparent", "opaque"] as ImageStudioBackground[]
              ).map((background) => (
                <button
                  key={background}
                  type="button"
                  className={styles["segment"]}
                  data-active={workspace.background === background}
                  onClick={() => setBackground(background)}
                >
                  {background === "auto"
                    ? "自动"
                    : background === "transparent"
                      ? "透明"
                      : "不透明"}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isGenerate && (
          <div className={styles["config-group"]}>
            <div className={styles["config-label"]}>
              {isEdit ? "参考图" : "源图"}
            </div>
            <div className={styles["compact-info"]}>
              {isEdit
                ? referenceAsset?.imageUrl
                  ? referenceAsset.title
                  : "未选择"
                : selectedAsset?.imageUrl
                  ? selectedAsset.title
                  : "未选择"}
            </div>
          </div>
        )}

        <div className={styles["config-group"]}>
          <div className={styles["config-label"]}>执行</div>
          {isEdit && (
            <button
              className={styles["secondary-button"]}
              type="button"
              disabled={isUploadingReference}
              onClick={uploadReferenceAsset}
            >
              {isUploadingReference ? "上传中..." : "上传参考图"}
            </button>
          )}
          <button
            className={styles["submit-button"]}
            type="button"
            disabled={isSubmitting}
            onClick={runGenerate}
          >
            {isSubmitting ? `${actionLabel}中...` : `立即${actionLabel}`}
          </button>
          {workspace.lastError && (
            <div className={styles["warning-text"]}>{workspace.lastError}</div>
          )}
        </div>
      </aside>
    </div>
  );
}
