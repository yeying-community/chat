import { getClientConfig } from "../config/client";
import {
  ApiPath,
  CACHE_URL_PREFIX,
  STORAGE_KEY,
  StoreKey,
} from "../constant";
import { createPersistStore } from "../utils/store";
import {
  AppState,
  getLocalAppState,
  getLocalAppStateForSync,
  GetStoreState,
  mergeAppState,
  setLocalAppState,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { createSyncClient, ProviderType } from "../utils/cloud";
import {
  getCachedUcanSession,
  refreshUcanSession,
} from "../plugins/ucan-session";
import { getUcanRootCapsKey, getWebdavAudience } from "../plugins/ucan";

type ImageUrlPart = {
  type?: string;
  image_url?: {
    url?: string;
  };
};

type MessageLike = {
  content?: unknown;
  audio_url?: string;
};

function isCacheMediaUrl(url?: string) {
  return typeof url === "string" && url.includes(CACHE_URL_PREFIX);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert blob to data URL"));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to convert blob to data URL"));
    reader.readAsDataURL(blob);
  });
}

function normalizeCacheUrl(url: string) {
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

async function loadCacheMediaBlob(url: string) {
  const normalizedUrl = normalizeCacheUrl(url);

  if (typeof caches !== "undefined") {
    // Prefer CacheStorage to avoid depending on ServiceWorker interception.
    const cached =
      (await caches.match(normalizedUrl)) ?? (await caches.match(url));
    if (cached) {
      return await cached.blob();
    }
  }

  const res = await fetch(url, {
    method: "GET",
    mode: "cors",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`load cache media failed: ${res.status} ${res.statusText}`);
  }
  return await res.blob();
}

async function convertCacheMediaUrl(
  url: string,
  resolvedUrls: Map<string, string>,
) {
  if (!isCacheMediaUrl(url)) return url;
  if (resolvedUrls.has(url)) {
    return resolvedUrls.get(url)!;
  }

  try {
    const blob = await loadCacheMediaBlob(url);
    const dataUrl = await blobToDataUrl(blob);
    resolvedUrls.set(url, dataUrl);
    return dataUrl;
  } catch (error) {
    resolvedUrls.set(url, url);
    console.warn("[Sync] failed to materialize cache media", { url, error });
    return url;
  }
}

async function materializeMessageMedia(
  messages: MessageLike[] | undefined,
  resolvedUrls: Map<string, string>,
) {
  if (!messages || messages.length === 0) return;

  for (const message of messages) {
    if (isCacheMediaUrl(message.audio_url)) {
      message.audio_url = await convertCacheMediaUrl(
        message.audio_url as string,
        resolvedUrls,
      );
    }

    if (!Array.isArray(message.content)) continue;

    for (const part of message.content as ImageUrlPart[]) {
      if (part?.type !== "image_url") continue;
      const url = part?.image_url?.url;
      if (!isCacheMediaUrl(url)) continue;
      if (!part.image_url) continue;
      part.image_url.url = await convertCacheMediaUrl(
        url as string,
        resolvedUrls,
      );
    }
  }
}

async function inlineCacheMediaForWebdavSync(appState: AppState) {
  const resolvedUrls = new Map<string, string>();
  const chatState = appState[StoreKey.Chat];

  for (const session of chatState.sessions) {
    await materializeMessageMedia(
      session.messages as MessageLike[],
      resolvedUrls,
    );
    await materializeMessageMedia(
      session.mask?.context as MessageLike[] | undefined,
      resolvedUrls,
    );
  }

  if (resolvedUrls.size > 0) {
    console.info("[Sync] inlined cache media for WebDAV sync", {
      count: resolvedUrls.size,
    });
  }
}

async function getLocalAppStateForUpload(provider: ProviderType) {
  const state = getLocalAppStateForSync();

  if (provider === ProviderType.WebDAV) {
    await inlineCacheMediaForWebdavSync(state);
  }

  return state;
}

export type WebDavAuthType = "basic" | "ucan";

export interface WebDavConfig {
  authType: WebDavAuthType;
  baseUrl: string;
  prefix: string;
  endpoint: string;
  username: string;
  password: string;
}

const isApp = !!getClientConfig()?.isApp;
export type SyncStore = GetStoreState<typeof useSyncStore>;

const isUcanRootMetaReady = (): boolean => {
  try {
    if (typeof localStorage === "undefined") return false;
    const expRaw = localStorage.getItem("ucanRootExp");
    const iss = localStorage.getItem("ucanRootIss");
    const caps = localStorage.getItem("ucanRootCaps");
    const account = localStorage.getItem("currentAccount") || "";
    if (!expRaw || !iss || !account || !caps) return false;
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp <= Date.now()) return false;
    if (caps !== getUcanRootCapsKey()) return false;
    return iss === `did:pkh:eth:${account.toLowerCase()}`;
  } catch {
    return false;
  }
};

const DEFAULT_SYNC_STATE = {
  provider: ProviderType.WebDAV,
  useProxy: false,
  proxyUrl: ApiPath.Cors as string,

  autoSync: true,
  autoSyncIntervalMs: 5 * 60 * 1000,
  autoSyncDebounceMs: 2000,

  webdav: {
    authType: "ucan" as WebDavAuthType,
    baseUrl: "",
    prefix: "",
    endpoint: "",
    username: "",
    password: "",
  },

  upstash: {
    endpoint: "",
    username: STORAGE_KEY,
    apiKey: "",
  },

  lastSyncTime: 0,
  lastProvider: "",
};

export const useSyncStore = createPersistStore(
  DEFAULT_SYNC_STATE,
  (set, get) => ({
    cloudSync() {
      const provider = get().provider;
      if (provider === ProviderType.WebDAV) {
        const { baseUrl, username, password } = get().webdav;
        if (get().webdav.authType === "ucan") {
          const envBaseUrl =
            getClientConfig()?.webdavBackendBaseUrl?.trim() || "";
          const backendUrl = baseUrl.trim() || envBaseUrl;
          const audience = getWebdavAudience(backendUrl);
          return Boolean(backendUrl && audience && isUcanRootMetaReady());
        }
        return [baseUrl, username, password].every(
          (value) => value.toString().length > 0,
        );
      }
      const config = get()[provider];
      return Object.values(config).every((c) => c.toString().length > 0);
    },

    markSyncTime() {
      set({ lastSyncTime: Date.now(), lastProvider: get().provider });
    },

    export() {
      const state = getLocalAppState();
      const datePart = isApp
        ? `${new Date().toLocaleDateString().replace(/\//g, "_")} ${new Date()
            .toLocaleTimeString()
            .replace(/:/g, "_")}`
        : new Date().toLocaleString();

      const fileName = `Backup-${datePart}.json`;
      downloadAs(JSON.stringify(state), fileName);
    },

    async import() {
      const rawContent = await readFromFile();

      try {
        const remoteState = JSON.parse(rawContent) as AppState;
        const localState = getLocalAppState();
        mergeAppState(localState, remoteState);
        setLocalAppState(localState);
        location.reload();
      } catch (e) {
        console.error("[Import]", e);
        showToast(Locale.Settings.Sync.ImportFailed);
      }
    },

    getClient() {
      const provider = get().provider;
      const client = createSyncClient(provider, get());
      return client;
    },

    async sync(options?: { interactive?: boolean }) {
      const provider = get().provider;
      const config = get()[provider];
      const interactive = options?.interactive ?? false;

      if (
        provider === ProviderType.WebDAV &&
        get().webdav.authType === "ucan" &&
        interactive
      ) {
        await refreshUcanSession();
      } else if (
        provider === ProviderType.WebDAV &&
        get().webdav.authType === "ucan" &&
        !interactive
      ) {
        const session = await getCachedUcanSession();
        if (!session) {
          return;
        }
      }

      const client = createSyncClient(provider, get());

      try {
        const remoteState = await client.get(config.username);
        if (!remoteState || remoteState === "") {
          const latestLocalState = await getLocalAppStateForUpload(provider);
          await client.set(config.username, JSON.stringify(latestLocalState));
          console.log(
            "[Sync] Remote state is empty, using local state instead.",
          );
          return;
        }

        const parsedRemoteState = JSON.parse(remoteState) as AppState;
        const latestLocalState = getLocalAppState();
        mergeAppState(latestLocalState, parsedRemoteState);
        setLocalAppState(latestLocalState);
      } catch (e) {
        console.log("[Sync] failed to get remote state", e);
        throw e;
      }

      const latestLocalState = await getLocalAppStateForUpload(provider);
      await client.set(config.username, JSON.stringify(latestLocalState));

      set({ lastSyncTime: Date.now(), lastProvider: provider });
    },

    async check() {
      try {
        const provider = get().provider;
        if (
          provider === ProviderType.WebDAV &&
          get().webdav.authType === "ucan"
        ) {
          await refreshUcanSession();
        }
        const client = createSyncClient(provider, get());
        return await client.check();
      } catch (e) {
        console.error("[Sync] failed to check", e);
        return false;
      }
    },
  }),
  {
    name: StoreKey.Sync,
    version: 1.5,

    migrate(persistedState, version) {
      const newState = persistedState as typeof DEFAULT_SYNC_STATE;

      if (version < 1.1) {
        newState.upstash.username = STORAGE_KEY;
      }

      if (version < 1.2) {
        if (
          (persistedState as typeof DEFAULT_SYNC_STATE).proxyUrl ===
          "/api/cors/"
        ) {
          newState.proxyUrl = "";
        }
      }

      if (version < 1.3) {
        if (!newState.webdav.authType) {
          newState.webdav.authType = "basic";
        }
        if (typeof newState.autoSync !== "boolean") {
          newState.autoSync = true;
        }
        if (!newState.autoSyncIntervalMs) {
          newState.autoSyncIntervalMs = 5 * 60 * 1000;
        }
        if (!newState.autoSyncDebounceMs) {
          newState.autoSyncDebounceMs = 2000;
        }
      }

      if (version < 1.4) {
        const isDefaultWebdavConfig =
          newState.webdav.authType === "basic" &&
          !newState.webdav.endpoint &&
          !newState.webdav.username &&
          !newState.webdav.password;
        if (isDefaultWebdavConfig) {
          newState.webdav.authType = "ucan";
        }
        if (
          typeof newState.useProxy !== "boolean" ||
          (newState.useProxy && newState.proxyUrl === ApiPath.Cors)
        ) {
          newState.useProxy = false;
        }
        if (typeof newState.autoSync !== "boolean") {
          newState.autoSync = true;
        }
      }

      if (version < 1.5) {
        if (!newState.webdav.baseUrl) {
          const endpoint =
            (newState.webdav as { endpoint?: string }).endpoint || "";
          try {
            const url = new URL(endpoint);
            newState.webdav.baseUrl = `${url.protocol}//${url.host}`;
            const pathname = url.pathname.replace(/\/+$/, "");
            newState.webdav.prefix = pathname === "/" ? "" : pathname;
          } catch {
            newState.webdav.baseUrl = endpoint;
            newState.webdav.prefix = "";
          }
        }
        if (!newState.webdav.prefix) {
          newState.webdav.prefix = "";
        }
      }

      return newState as any;
    },
  },
);
