import styles from "./auth.module.scss";
import { IconButton } from "./button";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Path, SAAS_CHAT_URL } from "../constant";
import Locale from "../locales";
import Delete from "../icons/close.svg";
import Arrow from "../icons/arrow.svg";
import Logo from "../icons/yeying.svg";
import { useMobileScreen } from "@/app/utils";
import { getClientConfig } from "../config/client";
import { safeLocalStorage } from "@/app/utils";
import { trackSettingsPageGuideToCPaymentClick } from "../utils/auth-settings-events";
import clsx from "clsx";
import {
  UCAN_AUTH_EVENT,
  connectWallet,
  getCurrentAccount,
  isValidUcanAuthorization,
} from "../plugins/wallet";

const storage = safeLocalStorage();
const WALLET_HISTORY_KEY = "walletAccountHistory";
const WALLET_HISTORY_LIMIT = 10;

function normalizeAccount(account?: string | null) {
  return (account ?? "").trim();
}

function parseWalletHistory(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeAccount(item))
      .filter((item) => {
        if (!item) return false;
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, WALLET_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function loadWalletHistory() {
  return parseWalletHistory(storage.getItem(WALLET_HISTORY_KEY));
}

function persistWalletHistory(history: string[]) {
  storage.setItem(WALLET_HISTORY_KEY, JSON.stringify(history));
}

function mergeWalletHistory(account: string, history: string[]) {
  if (!account) return history;
  return [
    account,
    ...history.filter((item) => item.toLowerCase() !== account.toLowerCase()),
  ].slice(0, WALLET_HISTORY_LIMIT);
}

export function AuthPage() {
  const navigate = useNavigate();
  const [ucanStatus, setUcanStatus] = useState<
    "checking" | "authorized" | "expired" | "unauthorized"
  >("checking");
  const [walletHistory, setWalletHistory] = useState<string[]>([]);
  const [selectedWalletAccount, setSelectedWalletAccount] = useState("");

  useEffect(() => {
    if (getClientConfig()?.isApp) {
      navigate(Path.Settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshStatus = async () => {
      const account = normalizeAccount(getCurrentAccount());
      const history = mergeWalletHistory(account, loadWalletHistory());
      const valid = await isValidUcanAuthorization();
      if (cancelled) return;
      if (history.length > 0) {
        persistWalletHistory(history);
      }
      setWalletHistory(history);
      setSelectedWalletAccount(account || "");
      if (valid) {
        setUcanStatus("authorized");
      } else if (account) {
        setUcanStatus("expired");
      } else {
        setUcanStatus("unauthorized");
      }
    };
    refreshStatus();
    const onAuthChange = () => {
      refreshStatus();
    };
    window.addEventListener(UCAN_AUTH_EVENT, onAuthChange);
    window.addEventListener("storage", onAuthChange);
    return () => {
      cancelled = true;
      window.removeEventListener(UCAN_AUTH_EVENT, onAuthChange);
      window.removeEventListener("storage", onAuthChange);
    };
  }, []);

  const handleWalletSelectChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const account = normalizeAccount(event.target.value);
    setSelectedWalletAccount(account);
    if (!account) return;
    storage.setItem("currentAccount", account);
  };

  const handleWalletConnect = () => {
    connectWallet(selectedWalletAccount || undefined);
  };

  const isWalletConnectDisabled = ucanStatus === "authorized";

  return (
    <div className={styles["auth-page"]}>
      <TopBanner></TopBanner>

      <div className={styles["auth-wallet"]}>
        <select
          className={styles["auth-wallet-select"]}
          value={selectedWalletAccount}
          onChange={handleWalletSelectChange}
          aria-label="wallet-history-select"
        >
          <option value="" disabled hidden>
            历史账户（可选）
          </option>
          {walletHistory.map((account) => (
            <option key={account} value={account}>
              {account}
            </option>
          ))}
        </select>
        <IconButton
          text="连接钱包"
          type="primary"
          className={styles["auth-wallet-connect"]}
          onClick={handleWalletConnect}
          disabled={isWalletConnectDisabled}
        />
      </div>
    </div>
  );
}

function TopBanner() {
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(() => {
    const bannerDismissed = storage.getItem("bannerDismissed");
    if (!bannerDismissed) {
      storage.setItem("bannerDismissed", "false");
      return true;
    }
    return bannerDismissed !== "true";
  });
  const isMobile = useMobileScreen();

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const handleClose = () => {
    setIsVisible(false);
    storage.setItem("bannerDismissed", "true");
  };

  if (!isVisible) {
    return null;
  }
  return (
    <div
      className={styles["top-banner"]}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={clsx(styles["top-banner-inner"], "no-dark")}>
        <Logo className={styles["top-banner-logo"]}></Logo>
        <span>
          {Locale.Auth.TopTips}
          <a
            href={SAAS_CHAT_URL}
            rel="stylesheet"
            onClick={() => {
              trackSettingsPageGuideToCPaymentClick();
            }}
          >
            {Locale.Settings.Access.SaasStart.ChatNow}
            <Arrow style={{ marginLeft: "4px" }} />
          </a>
        </span>
      </div>
      {(isHovered || isMobile) && (
        <Delete className={styles["top-banner-close"]} onClick={handleClose} />
      )}
    </div>
  );
}
