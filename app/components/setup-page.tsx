import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supportsTextEndpoint } from "../client/api";
import { Path, ServiceProvider } from "../constant";
import Locale from "../locales";
import { useAccessStore } from "../store/access";
import { useAppConfig } from "../store/config";
import { useSessionModels, useRouterTokenStatus } from "../utils/hooks";
import { getModelProvider, normalizeProviderName } from "../utils/model";
import styles from "./setup-page.module.scss";
import { IconButton } from "./button";
import LeftIcon from "../icons/left.svg";
import { UCAN_AUTH_EVENT } from "../plugins/wallet";

export function SetupPage() {
  const navigate = useNavigate();
  const accessStore = useAccessStore();
  const config = useAppConfig();
  const availableModels = useSessionModels();
  const textAvailableModels = useMemo(
    () =>
      availableModels.filter((model) => {
        const tags = Array.isArray(model.tags) ? model.tags : [];
        if (tags.length > 0) return tags.includes("text");
        const endpoints = model.supportedEndpoints ?? [];
        if (endpoints.length > 0) return supportsTextEndpoint(endpoints);
        return true;
      }),
    [availableModels],
  );
  const hasTextModels = textAvailableModels.length > 0;
  const hasRouterToken = accessStore.selectedRouterToken.trim().length > 0;
  const hasRouterApiKey = accessStore.openaiApiKey.trim().length > 0;
  const routerTokenStatus = useRouterTokenStatus();
  const routerAction =
    !hasRouterToken && !hasRouterApiKey
      ? "select"
      : routerTokenStatus.disabled
        ? "disabled"
        : routerTokenStatus.expired
          ? "renew"
          : routerTokenStatus.depleted
            ? "recharge"
            : "token";
  const routerRedirectTarget = `${Path.Router}?redirect=${encodeURIComponent(
    Path.Setup,
  )}&action=${routerAction}`;
  const routerGuidanceTitle =
    !hasRouterToken && !hasRouterApiKey
      ? Locale.NewChat.Router.SetupTitle
      : Locale.NewChat.Router.NoModelTitle;
  const routerGuidanceDescription =
    !hasRouterToken && !hasRouterApiKey
      ? Locale.NewChat.Router.SetupDesc
      : routerTokenStatus.disabled
        ? Locale.NewChat.Router.DisabledDesc
        : routerTokenStatus.expired
          ? Locale.NewChat.Router.ExpiredDesc
          : routerTokenStatus.depleted
            ? Locale.NewChat.Router.DepletedDesc
            : Locale.NewChat.Router.NoModelDesc;
  const currentModelLabel = useMemo(() => {
    if (textAvailableModels.length > 0) {
      const preferredProviderName =
        normalizeProviderName(config.modelConfig.providerName) ??
        ServiceProvider.OpenAI;
      const matched = textAvailableModels.find(
        (model) =>
          model.name === config.modelConfig.model &&
          model.provider?.providerName === preferredProviderName,
      );
      const fallback = matched ?? textAvailableModels[0];
      return fallback.displayName ?? fallback.name;
    }
    const [modelName] = getModelProvider(config.modelConfig.model);
    return modelName || config.modelConfig.model;
  }, [
    config.modelConfig.model,
    config.modelConfig.providerName,
    textAvailableModels,
  ]);

  return (
    <div className={styles["setup-page"]}>
      <div className={styles["setup-header"]}>
        <IconButton
          icon={<LeftIcon />}
          text={Locale.NewChat.Return}
          onClick={() => navigate(Path.Home)}
        />
      </div>

      <div>
        <div className={styles["setup-title"]}>{Locale.Setup.Title}</div>
        <div className={styles["setup-subtitle"]}>{Locale.Setup.SubTitle}</div>
      </div>

      <div className={styles["setup-band"]}>
        <div className={styles["setup-band-title"]}>{routerGuidanceTitle}</div>
        <div className={styles["setup-band-desc"]}>
          {routerGuidanceDescription}
        </div>
        <div className={styles["setup-actions"]}>
          <button
            type="button"
            className={styles["setup-primary"]}
            onClick={() => navigate(routerRedirectTarget)}
          >
            {Locale.NewChat.Router.OpenRouter}
          </button>
          <button
            type="button"
            className={styles["setup-secondary"]}
            onClick={() => navigate(Path.Settings)}
          >
            {Locale.Setup.OpenSettings}
          </button>
        </div>
      </div>

      <div className={styles["setup-band"]}>
        <div className={styles["setup-band-title"]}>
          {hasTextModels ? Locale.Setup.ReadyTitle : Locale.Setup.SectionTitle}
        </div>
        <div className={styles["setup-band-desc"]}>
          {hasTextModels
            ? `${Locale.Setup.ReadyDesc} ${currentModelLabel}`
            : Locale.Setup.SectionDesc}
        </div>
        <div className={styles["setup-actions"]}>
          <button
            type="button"
            className={styles["setup-ghost"]}
            onClick={() => window.dispatchEvent(new Event(UCAN_AUTH_EVENT))}
          >
            {Locale.Router.Banner.TokenPrimary}
          </button>
          {hasTextModels ? (
            <button
              type="button"
              className={styles["setup-primary"]}
              onClick={() => navigate(Path.NewChat)}
            >
              {Locale.Setup.Continue}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
