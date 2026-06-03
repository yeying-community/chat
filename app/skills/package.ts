import type { ModelCandidate } from "../client/api";
import type { Lang } from "../locales";
import type { ChatMessage } from "../store/chat";
import type { ModelConfig } from "../store/config";
import type { Skill } from "../store/skill";

export type LocalizedText = string | Partial<Record<Lang, string>>;

export type SkillIcon =
  | { type: "emoji"; value: string }
  | { type: "builtin"; value: string }
  | { type: "url"; value: string };

export type SkillLaunch =
  | { type: "chat" }
  | { type: "workspace"; target: "chat" | "sd" | "settings" | string }
  | { type: "external"; url: string };

export type SkillInstructions =
  | { type: "inline"; content: string }
  | { type: "file"; path: string };

export type SkillPackageModel = {
  syncGlobalConfig?: boolean;
  default?: {
    provider?: ModelConfig["providerName"];
    model?: string;
  };
  candidates?: ModelCandidate[];
  params?: Partial<ModelConfig>;
};

export type SkillTool = {
  id: string;
  name: string;
  description?: string;
  required: boolean;
};

export type SkillMcpServer = {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  required: boolean;
  configSchema?: Record<string, unknown>;
};

export type SkillPermissions = {
  network: boolean;
  filesystem: boolean;
  wallet: boolean;
  externalTools: string[];
  dataScopes?: string[];
};

export type SkillVisibility = {
  scope: "private" | "organization" | "public";
  roles?: string[];
  users?: string[];
};

export type SkillRelease = {
  status: "draft" | "published" | "deprecated" | "removed";
  review?: "pending" | "approved" | "rejected";
  changelog?: string;
};

export type SkillPackage = {
  schemaVersion: string;
  id: string;
  version: string;
  name: LocalizedText;
  description?: LocalizedText;
  author?: {
    name: string;
    url?: string;
  };
  icon?: SkillIcon;
  tags?: string[];
  category?: string;
  visibility?: SkillVisibility;
  launch?: SkillLaunch;
  instructions?: SkillInstructions;
  starters?: string[];
  model?: SkillPackageModel;
  tools?: SkillTool[];
  mcp?: {
    servers?: SkillMcpServer[];
  };
  ui?: {
    entryLabel?: LocalizedText;
    emptyState?: "minimal" | "guided";
  };
  permissions?: SkillPermissions;
  compatibility?: {
    appVersion?: string;
    mcp?: string;
  };
  release?: SkillRelease;
};

export function resolveLocalizedText(
  value: LocalizedText | undefined,
  lang: Lang,
  fallback = "",
) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return value[lang] ?? value.cn ?? value.en ?? fallback;
}

function resolveSkillAvatar(icon?: SkillIcon) {
  if (!icon) return "gpt-bot";
  return icon.value;
}

function resolveSkillContext(skillPackage: SkillPackage): ChatMessage[] {
  if (skillPackage.instructions?.type !== "inline") return [];

  return [
    {
      id: `${skillPackage.id}-instructions`,
      role: "system",
      content: skillPackage.instructions.content,
      date: "",
    },
  ];
}

function resolveLegacyLaunch(
  launch?: SkillLaunch,
): Skill["launch"] | undefined {
  if (!launch) return undefined;
  if (launch.type === "chat") return { type: "chat" };
  if (launch.type === "workspace" && launch.target === "sd") {
    return { type: "sd" };
  }
  if (launch.type === "workspace" && launch.target === "chat") {
    return { type: "chat" };
  }
  return undefined;
}

export function skillPackageToSkill(
  skillPackage: SkillPackage,
  lang: Lang,
  baseModelConfig: ModelConfig,
): Skill {
  return {
    id: skillPackage.id,
    createdAt: Date.now(),
    avatar: resolveSkillAvatar(skillPackage.icon),
    name: resolveLocalizedText(skillPackage.name, lang, skillPackage.id),
    description: resolveLocalizedText(skillPackage.description, lang),
    category: skillPackage.category,
    starters: skillPackage.starters,
    hideContext: true,
    context: resolveSkillContext(skillPackage),
    syncGlobalConfig: skillPackage.model?.syncGlobalConfig ?? true,
    modelConfig: {
      ...baseModelConfig,
      ...skillPackage.model?.params,
      model: skillPackage.model?.default?.model ?? baseModelConfig.model,
      providerName:
        skillPackage.model?.default?.provider ?? baseModelConfig.providerName,
    },
    candidateModels: skillPackage.model?.candidates,
    lang,
    builtin: false,
    plugin: skillPackage.tools?.map((tool) => tool.id) ?? [],
    launch: resolveLegacyLaunch(skillPackage.launch),
  };
}
