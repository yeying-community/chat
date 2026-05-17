import { nanoid } from "nanoid";

import { StoreKey } from "../constant";
import { DalleQuality, DalleStyle, ModelSize } from "../typing";
import { createPersistStore } from "../utils/store";

export type ImageStudioAction = "generate" | "edit" | "expand";
export type ImageStudioBackground = "auto" | "transparent" | "opaque";
export type ImageStudioAssetKind = "result" | "reference";

export interface ImageStudioAsset {
  id: string;
  kind: ImageStudioAssetKind;
  title: string;
  status: "placeholder" | "running" | "ready" | "error";
  imageUrl?: string;
  errorMessage?: string;
}

export interface ImageStudioWorkspace {
  sessionId: string;
  action: ImageStudioAction;
  prompt: string;
  size: ModelSize;
  quality: DalleQuality;
  style: DalleStyle;
  background: ImageStudioBackground;
  assets: ImageStudioAsset[];
  selectedAssetId?: string;
  lastError?: string;
  updatedAt: number;
}

type ImageStudioStoreState = {
  workspaces: Record<string, ImageStudioWorkspace>;
};

function createDefaultWorkspace(
  sessionId: string,
  overrides?: Partial<ImageStudioWorkspace>,
): ImageStudioWorkspace {
  const createdAt = Date.now();
  const resultId = nanoid();
  const referenceId = nanoid();

  return {
    sessionId,
    action: "generate",
    prompt: "",
    size: "1024x1024",
    quality: "standard",
    style: "vivid",
    background: "auto",
    assets: [
      {
        id: resultId,
        kind: "result",
        title: "当前结果",
        status: "placeholder",
      },
      {
        id: referenceId,
        kind: "reference",
        title: "参考图槽位",
        status: "placeholder",
      },
    ],
    selectedAssetId: resultId,
    updatedAt: createdAt,
    ...overrides,
  };
}

export const useImageStudioStore = createPersistStore<
  ImageStudioStoreState,
  {
    ensureWorkspace: (
      sessionId: string,
      overrides?: Partial<ImageStudioWorkspace>,
    ) => void;
    updateWorkspace: (
      sessionId: string,
      updater: (workspace: ImageStudioWorkspace) => void,
    ) => void;
    removeWorkspace: (sessionId: string) => void;
  }
>(
  {
    workspaces: {},
  },
  (set, get) => ({
    ensureWorkspace(sessionId, overrides) {
      const existingWorkspace = get().workspaces[sessionId];

      if (existingWorkspace) {
        return;
      }

      const nextWorkspace = createDefaultWorkspace(sessionId, overrides);

      set((state) => ({
        workspaces: {
          ...state.workspaces,
          [sessionId]: nextWorkspace,
        },
      }));
    },

    updateWorkspace(sessionId, updater) {
      const workspace = get().workspaces[sessionId];

      if (!workspace) {
        return;
      }

      const nextWorkspace = {
        ...workspace,
        assets: workspace.assets.slice(),
      };
      updater(nextWorkspace);
      nextWorkspace.updatedAt = Date.now();

      set((state) => ({
        workspaces: {
          ...state.workspaces,
          [sessionId]: nextWorkspace,
        },
      }));
    },

    removeWorkspace(sessionId) {
      const nextWorkspaces = { ...get().workspaces };
      delete nextWorkspaces[sessionId];

      set(() => ({
        workspaces: nextWorkspaces,
      }));
    },
  }),
  {
    name: StoreKey.ImageStudio,
    version: 1,
  },
);
