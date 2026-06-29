import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "./router-page.module.scss";

import ResetIcon from "../icons/reload.svg";
import CloseIcon from "../icons/close.svg";
import { IconButton } from "./button";
import {
  useAccessStore,
  useAppConfig,
  useSkillProviderModelsStore,
  useUpdateStore,
} from "../store";
import Locale from "../locales";
import { ErrorBoundary } from "./error";
import { getClientConfig } from "../config/client";
import {
  getRouterClientApi,
  normalizeSupportedEndpoints,
  supportsImageEditEndpoint,
  supportsImageGenerationEndpoint,
  supportsTextEndpoint,
  type LLMModel,
  SupportedEndpoint,
  SupportedTextEndpoint,
} from "../client/api";
import { isReasoningCapableModel } from "../client/reasoning";
import { Path, ServiceProvider } from "../constant";
import { useLocation, useNavigate } from "react-router-dom";
import {
  RouterApi,
  type RouterPublicToken,
  type RouterTokenStatus,
} from "../client/platforms/router";
import { buildTokenScopedRouterModelCatalog } from "./router-model-catalog";

const normalizeUrl = (value: string) => value.replace(/\/+$/, "");
const ROUTER_BASE_URL =
  getClientConfig()?.routerBackendUrl || "https://llm.yeying.pub/";
const ROUTER_BASE_URL_NORMALIZED = normalizeUrl(ROUTER_BASE_URL);
const ROUTER_PORTAL_URL =
  getClientConfig()?.routerPortalUrl || "https://router.yeying.pub";
const ROUTER_PORTAL_TOKEN_URL =
  getClientConfig()?.routerPortalTokenUrl || ROUTER_PORTAL_URL;
const ROUTER_PORTAL_RECHARGE_URL =
  getClientConfig()?.routerPortalRechargeUrl || ROUTER_PORTAL_TOKEN_URL;

type ModelFilter = "all" | "text" | "image" | "reasoning";

function getModelTags(model: LLMModel) {
  return Array.isArray(model.tags) ? model.tags : [];
}

function isImageModel(model: LLMModel) {
  const tags = getModelTags(model);
  const modelType = model.modelType?.trim().toLowerCase();
  return (
    tags.includes("image") ||
    modelType === "image" ||
    supportsImageGenerationEndpoint(model.supportedEndpoints) ||
    supportsImageEditEndpoint(model.supportedEndpoints)
  );
}

function isTextModel(model: LLMModel) {
  return supportsTextEndpoint(model.supportedEndpoints);
}

function isReasoningModel(model: LLMModel) {
  return isReasoningCapableModel({
    model: model.name,
    providerName: model.provider?.providerName,
    ownedBy: model.ownedBy,
    tags: model.tags,
  });
}

function getModelKind(model: LLMModel) {
  if (isImageModel(model)) return "image";
  if (isReasoningModel(model)) return "reasoning";
  if (isTextModel(model)) return "text";
  return "other";
}

function endpointLabel(endpoint: string) {
  switch (endpoint) {
    case SupportedTextEndpoint.Responses:
      return "responses";
    case SupportedTextEndpoint.Messages:
      return "messages";
    case SupportedTextEndpoint.ChatCompletions:
      return "chat";
    case SupportedEndpoint.ImagesGenerations:
      return "image gen";
    case SupportedEndpoint.ImagesEdits:
      return "image edit";
    default:
      return endpoint.replace(/^\/v1\//, "");
  }
}

function maskRouterTokenKey(value?: string) {
  const token = value?.trim() || "";
  if (!token) return "";
  const visiblePrefix = token.slice(0, Math.min(6, token.length));
  const visibleSuffix = token.length > 10 ? token.slice(-4) : "";
  if (!visibleSuffix) return `${visiblePrefix}***`;
  return `${visiblePrefix}***${visibleSuffix}`;
}

function capabilityBadges(model: LLMModel) {
  const badges: string[] = [];
  if (isTextModel(model)) badges.push("文本");
  if (supportsImageGenerationEndpoint(model.supportedEndpoints))
    badges.push("生图");
  if (supportsImageEditEndpoint(model.supportedEndpoints)) badges.push("编辑");
  if (isReasoningModel(model)) badges.push("深度思考");
  return badges;
}

function formatRouterDate(value?: number) {
  if (!value || value <= 0) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未设置";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function isRouterTokenSelectable(token: RouterPublicToken) {
  const status = token.status;
  const statusValue =
    typeof status === "string" ? status.trim().toLowerCase() : status;
  const statusOk =
    statusValue === undefined ||
    statusValue === null ||
    statusValue === "" ||
    statusValue === 1 ||
    statusValue === "1" ||
    statusValue === "enabled" ||
    statusValue === "active";

  if (!statusOk) return false;

  if (token.unlimited_quota === true) return true;

  const remaining = token.remaining_amount ?? token.remain_quota;
  if (remaining === undefined || remaining === null) return true;
  return Number(remaining) > 0;
}

export function RouterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const configPanelRef = useRef<HTMLElement | null>(null);
  const mergeModels = useAppConfig((state) => state.mergeModels);
  const accessStore = useAccessStore();
  const updateStore = useUpdateStore();
  const providerModels = useSkillProviderModelsStore((state) => state.models);
  const setProviderModels = useSkillProviderModelsStore(
    (state) => state.setModels,
  );
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState<ModelFilter>("all");
  const [tokens, setTokens] = useState<RouterPublicToken[]>([]);
  const [tokenModels, setTokenModels] = useState<LLMModel[]>([]);
  const [tokenStatus, setTokenStatus] = useState<RouterTokenStatus | null>(
    null,
  );

  const catalogModels = useMemo(() => {
    const map = new Map<string, LLMModel>();
    const source = buildTokenScopedRouterModelCatalog(
      tokenModels,
      providerModels,
    );

    source.forEach((model) => {
      const providerId =
        model.provider?.id ||
        model.provider?.providerName ||
        model.ownedBy ||
        "unknown";
      map.set(`${model.name}@${providerId}`, model);
    });
    return Array.from(map.values());
  }, [providerModels, tokenModels]);

  const visibleModels = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return catalogModels.filter((model) => {
      const kind = getModelKind(model);
      const matchesFilter =
        filter === "all" ||
        (filter === "text" && isTextModel(model)) ||
        (filter === "image" && isImageModel(model)) ||
        (filter === "reasoning" && isReasoningModel(model));
      if (!matchesFilter) return false;

      if (!keyword) return true;
      const haystack = [
        model.name,
        model.displayName,
        model.provider?.providerName,
        model.ownedBy,
        ...getModelTags(model),
        ...normalizeSupportedEndpoints(model.supportedEndpoints),
        kind,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [catalogModels, filter, searchText]);

  const endpointValue = accessStore.openaiUrl || ROUTER_BASE_URL_NORMALIZED;
  const selectedRouterToken = accessStore.selectedRouterToken?.trim() || "";
  const tokenConfigured = selectedRouterToken.length > 0;
  const routerApiKeyConfigured = accessStore.openaiApiKey.trim().length > 0;
  const showUsage = tokenConfigured || routerApiKeyConfigured;
  const usage = {
    used: updateStore.used,
    subscription: updateStore.subscription,
  };
  const availableTokens = useMemo(
    () => tokens.filter((token) => token && isRouterTokenSelectable(token)),
    [tokens],
  );
  const defaultToken = availableTokens[0];
  const selectedToken =
    availableTokens.find(
      (token) => (token.key || "").trim() === selectedRouterToken,
    ) || defaultToken;
  const redirectTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const raw = (params.get("redirect") || Path.NewChat).trim();
    if (!raw.startsWith("/")) return Path.NewChat;
    return raw === Path.Router ? Path.NewChat : raw;
  }, [location.search]);
  const routerAction = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return (params.get("action") || "").trim().toLowerCase();
  }, [location.search]);
  const canReturnToChat = tokenConfigured || tokenModels.length > 0;

  const updateRouterAccess = (updater: (state: typeof accessStore) => void) => {
    accessStore.update((state) => {
      state.provider = ServiceProvider.OpenAI;
      state.useCustomConfig = true;
      updater(state as typeof accessStore);
    });
  };

  const checkUsage = useCallback(
    async (force = false) => {
      if (!showUsage) return;
      setLoadingUsage(true);
      try {
        await updateStore.updateUsage(force);
      } finally {
        setLoadingUsage(false);
      }
    },
    [showUsage, updateStore],
  );

  async function loadTokenStatus() {
    setLoadingStatus(true);
    try {
      const api = new RouterApi();
      const nextStatus = await api.publicTokenStatus();
      setTokenStatus(nextStatus);
    } finally {
      setLoadingStatus(false);
    }
  }

  const routerActionContent = useMemo(() => {
    switch (routerAction) {
      case "select":
        return {
          title: "先选择一个可用令牌",
          description:
            "选择令牌后，Chat 会立即使用该令牌加载文本、图片和实时语音模型。",
          primaryText: "前往令牌中心",
          primaryAction: () => window.open(ROUTER_PORTAL_TOKEN_URL, "_blank"),
          secondaryText: "返回 Chat",
          secondaryAction: () => navigate(redirectTarget),
        };
      case "recharge":
        return {
          title: "当前令牌额度不足",
          description:
            "请前往 Router 管理中心充值或更换令牌，完成后回到 Chat 即可继续使用。",
          primaryText: "前往充值",
          primaryAction: () =>
            window.open(ROUTER_PORTAL_RECHARGE_URL, "_blank"),
          secondaryText: "重新检查",
          secondaryAction: () => {
            void loadTokenStatus();
            void checkUsage(true);
          },
        };
      case "renew":
        return {
          title: "当前令牌已过期",
          description:
            "请在 Router 管理中心续费或切换到新的可用令牌，然后回到 Chat 继续使用。",
          primaryText: "前往管理中心",
          primaryAction: () =>
            window.open(ROUTER_PORTAL_RECHARGE_URL, "_blank"),
          secondaryText: "重新检查",
          secondaryAction: () => {
            void loadTokenStatus();
            void checkUsage(true);
          },
        };
      case "disabled":
        return {
          title: "当前令牌不可用",
          description:
            "这个令牌已被禁用或失效，请重新选择一个可用令牌后再回到 Chat。",
          primaryText: "重新选择令牌",
          primaryAction: () => {
            configPanelRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          },
          secondaryText: "返回 Chat",
          secondaryAction: () => navigate(redirectTarget),
        };
      case "token":
        return {
          title: "完成 Router 配置后即可开始使用",
          description:
            "优先选择一个可用令牌；如果模型或额度状态刚刚变化，可以先重新检查一次。",
          primaryText: "重新检查",
          primaryAction: () => {
            void loadTokenStatus();
            void checkUsage(true);
          },
          secondaryText: "返回 Chat",
          secondaryAction: () => navigate(redirectTarget),
        };
      default:
        return null;
    }
  }, [checkUsage, navigate, redirectTarget, routerAction]);

  const reloadModels = useCallback(async () => {
    setLoadingModels(true);
    setTokenModels([]);
    try {
      const api = getRouterClientApi();
      const [models, nextProviderModels] = await Promise.all([
        api.llm.models(),
        api.llm.providerModels?.() ?? Promise.resolve([]),
      ]);
      setTokenModels(models);
      mergeModels(models);
      setProviderModels(nextProviderModels);
    } finally {
      setLoadingModels(false);
    }
  }, [mergeModels, setProviderModels]);

  async function loadTokens() {
    setLoadingTokens(true);
    try {
      const api = new RouterApi();
      const nextTokens = await api.publicTokens();
      setTokens(nextTokens);
    } finally {
      setLoadingTokens(false);
    }
  }

  useEffect(() => {
    void loadTokens();
  }, []);

  useEffect(() => {
    if (loadingTokens) return;
    const nextToken = selectedToken?.key?.trim() || "";
    if (selectedRouterToken === nextToken) return;
    accessStore.update((state) => {
      state.selectedRouterToken = nextToken;
    });
  }, [accessStore, loadingTokens, selectedRouterToken, selectedToken]);

  useEffect(() => {
    void loadTokenStatus();
  }, [selectedRouterToken]);

  useEffect(() => {
    if (!selectedRouterToken) {
      setTokenModels([]);
      return;
    }
    void reloadModels();
  }, [reloadModels, selectedRouterToken]);

  useEffect(() => {
    if (routerAction !== "token") return;
    const panel = configPanelRef.current;
    if (!panel) return;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    panel.classList.add(styles["panel-focus"]);
    const timer = window.setTimeout(() => {
      panel.classList.remove(styles["panel-focus"]);
    }, 1800);

    return () => {
      window.clearTimeout(timer);
      panel.classList.remove(styles["panel-focus"]);
    };
  }, [routerAction]);

  return (
    <ErrorBoundary>
      <div className={styles["router-page"]}>
        <div className="window-header" data-tauri-drag-region>
          <div className="window-header-title">
            <div className="window-header-main-title">
              {Locale.Discovery.RouterProviderTitle}
            </div>
            <div className="window-header-sub-title">
              {Locale.Discovery.RouterProviderDesc}
            </div>
          </div>
          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<ResetIcon />}
                text="刷新模型"
                bordered
                onClick={() => void reloadModels()}
                disabled={loadingModels}
              />
            </div>
            <div className="window-action-button">
              <IconButton
                text={canReturnToChat ? "前往 Chat" : "前往新建会话"}
                bordered
                onClick={() => navigate(redirectTarget)}
              />
            </div>
            <div className="window-action-button">
              <IconButton
                aria={Locale.UI.Close}
                icon={<CloseIcon />}
                onClick={() => navigate(Path.Discovery)}
                bordered
              />
            </div>
          </div>
        </div>

        <div className={styles["router-content"]}>
          {routerActionContent && (
            <section className={styles["action-banner"]}>
              <div className={styles["action-banner-copy"]}>
                <div className={styles["action-banner-title"]}>
                  {routerActionContent.title}
                </div>
                <div className={styles["action-banner-desc"]}>
                  {routerActionContent.description}
                </div>
              </div>
              <div className={styles["action-banner-actions"]}>
                <button
                  type="button"
                  className={styles["action-banner-primary"]}
                  onClick={routerActionContent.primaryAction}
                >
                  {routerActionContent.primaryText}
                </button>
                <button
                  type="button"
                  className={styles["action-banner-secondary"]}
                  onClick={routerActionContent.secondaryAction}
                >
                  {routerActionContent.secondaryText}
                </button>
              </div>
            </section>
          )}

          <section className={styles.panel}>
            <div className={styles["panel-header"]}>
              <div>
                <div className={styles["panel-title"]}>Router 状态</div>
                <div className={styles["panel-subtitle"]}>
                  当前令牌状态和账户使用情况。
                </div>
              </div>
              <div className={styles["panel-actions"]}>
                <div className={styles["status-inline"]}>
                  <span
                    className={
                      tokenConfigured
                        ? styles["status-on"]
                        : styles["status-off"]
                    }
                  >
                    模型令牌 {tokenConfigured ? "已选择" : "未选择"}
                  </span>
                  <span
                    className={
                      showUsage ? styles["status-on"] : styles["status-off"]
                    }
                  >
                    余额查询 {showUsage ? "可用" : "未就绪"}
                  </span>
                </div>
                <div className={styles["action-pair"]}>
                  <IconButton
                    icon={<ResetIcon />}
                    text={loadingStatus ? "检查中" : "重新检查"}
                    bordered
                    onClick={() => {
                      void loadTokenStatus();
                      void checkUsage(true);
                    }}
                    disabled={loadingStatus || loadingUsage}
                  />
                </div>
              </div>
            </div>

            <div className={styles["status-layout"]}>
              <div className={styles["status-main"]}>
                <dl className={styles["info-list"]}>
                  <div className={styles["info-item"]}>
                    <dt>当前令牌</dt>
                    <dd>
                      {loadingStatus
                        ? "检查中"
                        : tokenStatus?.token_name ||
                          selectedToken?.name ||
                          "未选择"}
                    </dd>
                  </div>

                  <div className={styles["info-item"]}>
                    <dt>可用额度</dt>
                    <dd>
                      {loadingStatus
                        ? "检查中"
                        : tokenStatus?.unlimited_quota
                          ? "无限"
                          : (tokenStatus?.total_available ??
                            tokenStatus?.remaining_amount ??
                            "未获取")}
                    </dd>
                  </div>

                  <div className={styles["info-item"]}>
                    <dt>已使用</dt>
                    <dd>
                      {loadingStatus
                        ? "检查中"
                        : (tokenStatus?.total_used ??
                          tokenStatus?.used_amount ??
                          "未获取")}
                    </dd>
                  </div>

                  <div className={styles["info-item"]}>
                    <dt>过期时间</dt>
                    <dd>
                      {loadingStatus
                        ? "检查中"
                        : formatRouterDate(tokenStatus?.expires_at)}
                    </dd>
                  </div>

                  <div className={styles["info-item"]}>
                    <dt>{Locale.Settings.Usage.Title}</dt>
                    <dd>
                      {showUsage
                        ? loadingUsage
                          ? Locale.Settings.Usage.IsChecking
                          : Locale.Settings.Usage.SubTitle(
                              usage.used ?? "[?]",
                              usage.subscription ?? "[?]",
                            )
                        : Locale.Settings.Usage.NoAccess}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <section
            ref={configPanelRef}
            className={styles.panel}
            data-router-section="token"
          >
            <div className={styles["panel-header"]}>
              <div>
                <div className={styles["panel-title"]}>Router 配置</div>
                <div className={styles["panel-subtitle"]}>
                  接入地址和默认模型令牌。
                </div>
              </div>
            </div>

            <div className={styles.form}>
              <label className={styles.field}>
                <span className={styles["field-label"]}>接口地址</span>
                <input
                  type="text"
                  value={endpointValue}
                  placeholder={ROUTER_BASE_URL_NORMALIZED}
                  onChange={(e) =>
                    updateRouterAccess((state) => {
                      state.openaiUrl = e.currentTarget.value;
                    })
                  }
                />
                <span className={styles["field-hint"]}>
                  默认地址：{ROUTER_BASE_URL_NORMALIZED}
                </span>
              </label>

              <label className={styles.field}>
                <span className={styles["field-label"]}>令牌</span>
                <select
                  value={selectedRouterToken}
                  onChange={(e) =>
                    accessStore.update((state) => {
                      state.selectedRouterToken = e.currentTarget.value;
                    })
                  }
                  disabled={loadingTokens || availableTokens.length === 0}
                >
                  {availableTokens.length > 0 ? (
                    availableTokens.map((token) => {
                      const label = token.name || "未命名";
                      return (
                        <option
                          key={token.id || token.key}
                          value={token.key || ""}
                        >
                          {label}
                          {token.key
                            ? ` (${maskRouterTokenKey(token.key)})`
                            : ""}
                        </option>
                      );
                    })
                  ) : (
                    <option value="">
                      {loadingTokens ? "令牌加载中" : "未找到可用令牌"}
                    </option>
                  )}
                </select>
                <span className={styles["field-hint"]}>
                  文本、图片、语音和模型列表都会优先使用这里选择的令牌。
                </span>
              </label>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles["panel-header"]}>
              <div>
                <div className={styles["panel-title"]}>支持模型</div>
                <div className={styles["panel-subtitle"]}>
                  当前令牌可用的模型。
                </div>
              </div>
            </div>

            <div className={styles.toolbar}>
              <input
                className={styles.search}
                value={searchText}
                placeholder="搜索模型名、供应商、端点"
                onChange={(e) => setSearchText(e.currentTarget.value)}
              />
              <div className={styles.filters}>
                {[
                  ["all", "全部"],
                  ["text", "文本"],
                  ["image", "图片"],
                  ["reasoning", "深度思考"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      filter === value ? styles["filter-active"] : styles.filter
                    }
                    onClick={() => setFilter(value as ModelFilter)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {visibleModels.length > 0 ? (
              <div className={styles["table-shell"]}>
                <table className={styles["model-table"]}>
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th>供应商</th>
                      <th>能力</th>
                      <th>端点</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleModels.map((model) => {
                      const endpoints = normalizeSupportedEndpoints(
                        model.supportedEndpoints,
                      );
                      const capabilities = capabilityBadges(model);
                      const providerName =
                        model.provider?.providerName ||
                        model.ownedBy ||
                        "Unknown";
                      return (
                        <tr key={`${model.name}@${providerName}`}>
                          <td className={styles["cell-model"]}>
                            <div className={styles["model-title"]}>
                              {model.displayName || model.name}
                            </div>
                            <div className={styles["model-name"]}>
                              {model.name}
                            </div>
                          </td>
                          <td className={styles["cell-provider"]}>
                            {providerName}
                          </td>
                          <td>
                            <div className={styles["cell-tags"]}>
                              {capabilities.length > 0 ? (
                                capabilities.map((item) => (
                                  <span
                                    key={item}
                                    className={styles["chip-accent"]}
                                  >
                                    {item}
                                  </span>
                                ))
                              ) : (
                                <span className={styles.chip}>通用</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className={styles["cell-tags"]}>
                              {endpoints.length > 0 ? (
                                endpoints.map((endpoint) => (
                                  <span
                                    key={endpoint}
                                    className={styles["endpoint-chip"]}
                                  >
                                    {endpointLabel(endpoint)}
                                  </span>
                                ))
                              ) : (
                                <span className={styles["summary-empty"]}>
                                  未声明端点
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.empty}>
                {loadingModels
                  ? "模型加载中"
                  : selectedRouterToken
                    ? "当前令牌没有返回可用模型"
                    : "请选择令牌后加载模型"}
              </div>
            )}
          </section>
        </div>
      </div>
    </ErrorBoundary>
  );
}
