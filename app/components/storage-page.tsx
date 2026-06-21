import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getClientConfig } from "../config/client";
import { Path } from "../constant";
import CloseIcon from "../icons/close.svg";
import ConfigIcon from "../icons/config.svg";
import ConnectionIcon from "../icons/connection.svg";
import DownloadIcon from "../icons/download.svg";
import ResetIcon from "../icons/reload.svg";
import LoadingIcon from "../icons/three-dots.svg";
import UploadIcon from "../icons/upload.svg";
import Locale from "../locales";
import { fetchQuota, WebDAVQuota } from "../plugins/webdav";
import { useChatStore } from "../store";
import { usePromptStore } from "../store/prompt";
import { useSkillStore } from "../store/skill";
import { useSyncStore } from "../store/sync";
import { formatBytes } from "../utils/format";
import { IconButton } from "./button";
import { ErrorBoundary } from "./error";
import { SyncConfigModal } from "./settings";
import { List, ListItem, showToast } from "./ui-lib";
import styles from "./storage-page.module.scss";

type CheckState = "none" | "checking" | "success" | "failed";
type QuotaState = "idle" | "loading" | "ready" | "error";

function resolveConfigUrl(url?: string | null): string {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return "";
  }
}

function openExternalUrl(url: string) {
  if (!url) return;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = url;
  }
}

export function StoragePage() {
  const navigate = useNavigate();
  const syncStore = useSyncStore();
  const chatStore = useChatStore();
  const promptStore = usePromptStore();
  const skillStore = useSkillStore();
  const webdavPortalUrl = resolveConfigUrl(
    getClientConfig()?.webdavBackendBaseUrl,
  );
  const configured = syncStore.cloudSync();

  const [quota, setQuota] = useState<WebDAVQuota>();
  const [quotaState, setQuotaState] = useState<QuotaState>("idle");
  const [checkState, setCheckState] = useState<CheckState>("none");
  const [syncing, setSyncing] = useState(false);
  const [showSyncConfigModal, setShowSyncConfigModal] = useState(false);

  const stateOverview = useMemo(() => {
    const sessions = chatStore.sessions;
    const messageCount = sessions.reduce((p, c) => p + c.messages.length, 0);

    return {
      chat: sessions.length,
      message: messageCount,
      prompt: Object.keys(promptStore.prompts).length,
      skill: Object.keys(skillStore.skills).length,
    };
  }, [chatStore.sessions, promptStore.prompts, skillStore.skills]);

  const status = !configured
    ? "warning"
    : checkState === "failed" || quotaState === "error"
      ? "error"
      : "ready";
  const statusText = !configured
    ? Locale.Storage.StatusNeedsConfig
    : checkState === "checking" || quotaState === "loading"
      ? Locale.Storage.StatusChecking
      : status === "error"
        ? Locale.Storage.StatusError
        : Locale.Storage.StatusReady;

  const refreshQuota = async () => {
    if (!syncStore.cloudSync()) {
      setQuota(undefined);
      setQuotaState("idle");
      return;
    }

    setQuotaState("loading");
    const nextQuota = await fetchQuota();
    setQuota(nextQuota);
    setQuotaState(nextQuota ? "ready" : "error");
  };

  useEffect(() => {
    let cancelled = false;

    const loadQuota = async () => {
      if (!configured) {
        setQuota(undefined);
        setQuotaState("idle");
        return;
      }

      setQuotaState("loading");
      const nextQuota = await fetchQuota();
      if (cancelled) return;
      setQuota(nextQuota);
      setQuotaState(nextQuota ? "ready" : "error");
    };

    void loadQuota();

    return () => {
      cancelled = true;
    };
  }, [
    configured,
    syncStore.lastSyncTime,
    syncStore.provider,
    syncStore.webdav.authType,
    syncStore.webdav.baseUrl,
    syncStore.webdav.prefix,
    syncStore.webdav.username,
    syncStore.webdav.password,
  ]);

  const checkConnection = async () => {
    setCheckState("checking");
    const valid = await syncStore.check();
    setCheckState(valid ? "success" : "failed");
    showToast(valid ? Locale.Storage.CheckSuccess : Locale.Storage.CheckFail);
    if (valid) {
      await refreshQuota();
    }
  };

  const syncNow = async () => {
    try {
      setSyncing(true);
      await syncStore.sync({ interactive: true });
      showToast(Locale.Settings.Sync.Success);
      await refreshQuota();
    } catch (error) {
      showToast(Locale.Settings.Sync.Fail);
      console.error("[Storage] sync failed", error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className={styles["storage-page"]}>
        <div className="window-header" data-tauri-drag-region>
          <div className="window-header-title">
            <div className="window-header-main-title">
              {Locale.Storage.Title}
            </div>
            <div className="window-header-sub-title">
              {Locale.Storage.SubTitle}
            </div>
          </div>
          <div className="window-actions">
            <div className="window-action-button"></div>
            <div className="window-action-button"></div>
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

        <div className={styles.body}>
          <div className={styles["summary-grid"]}>
            <div className={`${styles.card} ${styles["status-card"]}`}>
              <div className={styles["status-title"]}>
                <span
                  className={`${styles["status-dot"]} ${
                    status === "ready"
                      ? styles["status-ready"]
                      : status === "error"
                        ? styles["status-error"]
                        : styles["status-warning"]
                  }`}
                />
                <span>{statusText}</span>
              </div>
              <div className={styles["status-desc"]}>
                {Locale.Storage.StatusDesc}
              </div>
              <div className={styles.actions}>
                <IconButton
                  icon={
                    checkState === "checking" ? (
                      <LoadingIcon />
                    ) : (
                      <ConnectionIcon />
                    )
                  }
                  text={Locale.Storage.Check}
                  bordered
                  disabled={checkState === "checking"}
                  onClick={checkConnection}
                />
                <IconButton
                  icon={syncing ? <LoadingIcon /> : <ResetIcon />}
                  text={Locale.Storage.SyncNow}
                  bordered
                  disabled={!configured || syncing}
                  onClick={syncNow}
                />
                <IconButton
                  icon={<ConfigIcon />}
                  text={Locale.Storage.Configure}
                  type="primary"
                  bordered
                  onClick={() => setShowSyncConfigModal(true)}
                />
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles["quota-grid"]}>
                <div className={styles["quota-item"]}>
                  <div className={styles["quota-label"]}>
                    {Locale.Storage.QuotaTotal}
                  </div>
                  <div className={styles["quota-value"]}>
                    {quota?.unlimited ? "∞" : formatBytes(quota?.quota)}
                  </div>
                </div>
                <div className={styles["quota-item"]}>
                  <div className={styles["quota-label"]}>
                    {Locale.Storage.QuotaUsed}
                  </div>
                  <div className={styles["quota-value"]}>
                    {formatBytes(quota?.used)}
                  </div>
                </div>
                <div className={styles["quota-item"]}>
                  <div className={styles["quota-label"]}>
                    {Locale.Storage.QuotaAvailable}
                  </div>
                  <div className={styles["quota-value"]}>
                    {quota?.unlimited ? "∞" : formatBytes(quota?.available)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={styles["section-title"]}>
            {Locale.Storage.DataTitle}
          </div>
          <List>
            <ListItem
              title={Locale.Storage.LastSync}
              subTitle={
                syncStore.lastProvider
                  ? `${new Date(syncStore.lastSyncTime).toLocaleString()} [${
                      syncStore.lastProvider
                    }]`
                  : Locale.Settings.Sync.NotSyncYet
              }
            />
            <ListItem
              title={Locale.Storage.LocalData}
              subTitle={Locale.Settings.Sync.Overview(stateOverview)}
            >
              <div className={styles.actions}>
                <IconButton
                  aria={Locale.Settings.Sync.LocalState + Locale.UI.Export}
                  icon={<UploadIcon />}
                  text={Locale.UI.Export}
                  onClick={() => syncStore.export()}
                />
                <IconButton
                  aria={Locale.Settings.Sync.LocalState + Locale.UI.Import}
                  icon={<DownloadIcon />}
                  text={Locale.UI.Import}
                  onClick={() => syncStore.import()}
                />
              </div>
            </ListItem>
            <ListItem
              title={Locale.Storage.Expansion}
              subTitle={Locale.Storage.ExpansionDesc}
            >
              <IconButton
                text={Locale.Storage.Expand}
                type="primary"
                onClick={() => {
                  if (!webdavPortalUrl) {
                    console.warn(
                      "[Storage] missing webdavBackendBaseUrl in client config",
                    );
                    return;
                  }
                  openExternalUrl(webdavPortalUrl);
                }}
              />
            </ListItem>
          </List>
        </div>

        {showSyncConfigModal && (
          <SyncConfigModal onClose={() => setShowSyncConfigModal(false)} />
        )}
      </div>
    </ErrorBoundary>
  );
}
