import styles from "./auth.module.scss";
import { IconButton } from "./button";
import { useState, useEffect, useRef } from "react";
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

function formatWalletAccount(account: string) {
  if (account.length <= 18) return account;
  return `${account.slice(0, 10)}...${account.slice(-8)}`;
}

export function AuthPage() {
  const navigate = useNavigate();
  const [ucanStatus, setUcanStatus] = useState<
    "checking" | "authorized" | "expired" | "unauthorized"
  >("checking");
  const [walletHistory, setWalletHistory] = useState<string[]>([]);
  const [selectedWalletAccount, setSelectedWalletAccount] = useState("");
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!isWalletMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (
        walletMenuRef.current &&
        target instanceof Node &&
        !walletMenuRef.current.contains(target)
      ) {
        setIsWalletMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsWalletMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isWalletMenuOpen]);

  const handleWalletAccountSelect = (account: string) => {
    const normalized = normalizeAccount(account);
    setSelectedWalletAccount(normalized);
    setIsWalletMenuOpen(false);
    if (!normalized) return;
    storage.setItem("currentAccount", normalized);
  };

  const handleWalletConnect = () => {
    connectWallet(selectedWalletAccount || undefined);
  };

  const isWalletConnectDisabled = ucanStatus === "authorized";
  const selectedWalletLabel = selectedWalletAccount
    ? formatWalletAccount(selectedWalletAccount)
    : "历史账户（可选）";

  const handleWalletMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsWalletMenuOpen((open) => !open);
    }
  };

  return (
    <div className={styles["auth-page"]}>
      <TopBanner></TopBanner>

      <div className={styles["auth-wallet"]}>
        <div className={styles["auth-wallet-select-wrap"]} ref={walletMenuRef}>
          <button
            type="button"
            className={styles["auth-wallet-select"]}
            aria-label="wallet-history-select"
            aria-haspopup="listbox"
            aria-expanded={isWalletMenuOpen}
            onClick={() => setIsWalletMenuOpen((open) => !open)}
            onKeyDown={handleWalletMenuKeyDown}
          >
            <span
              className={
                selectedWalletAccount
                  ? styles["auth-wallet-select-value"]
                  : styles["auth-wallet-select-placeholder"]
              }
              title={selectedWalletAccount || undefined}
            >
              {selectedWalletLabel}
            </span>
            <span
              className={styles["auth-wallet-select-arrow"]}
              data-open={isWalletMenuOpen}
            />
          </button>
          {isWalletMenuOpen && (
            <div className={styles["auth-wallet-menu"]} role="listbox">
              {walletHistory.length > 0 ? (
                walletHistory.map((account) => (
                  <button
                    type="button"
                    key={account}
                    className={styles["auth-wallet-option"]}
                    data-active={
                      account.toLowerCase() ===
                      selectedWalletAccount.toLowerCase()
                    }
                    onClick={() => handleWalletAccountSelect(account)}
                    title={account}
                  >
                    {account}
                  </button>
                ))
              ) : (
                <div className={styles["auth-wallet-option-empty"]}>
                  暂无历史账户
                </div>
              )}
            </div>
          )}
        </div>
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
