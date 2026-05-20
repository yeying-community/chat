import { getRuntimePublicConfig, type RuntimePublicConfig } from "./runtime";

declare global {
  interface Window {
    __CHAT_RUNTIME_CONFIG__?: RuntimePublicConfig;
  }
}

function readRuntimeConfigFromMeta(): RuntimePublicConfig | undefined {
  if (typeof document === "undefined") return undefined;
  const content = queryMeta("runtime-config");
  if (!content) return undefined;
  try {
    return JSON.parse(content) as RuntimePublicConfig;
  } catch {
    return undefined;
  }
}

export function getClientConfig() {
  if (typeof document !== "undefined") {
    if (window.__CHAT_RUNTIME_CONFIG__) {
      return window.__CHAT_RUNTIME_CONFIG__;
    }

    const config = readRuntimeConfigFromMeta();
    if (config) {
      window.__CHAT_RUNTIME_CONFIG__ = config;
      return config;
    }

    return undefined;
  }

  if (typeof process !== "undefined") {
    return getRuntimePublicConfig();
  }
}

export function setClientConfig(config: RuntimePublicConfig) {
  if (typeof window === "undefined") return;
  window.__CHAT_RUNTIME_CONFIG__ = config;
}

function queryMeta(key: string, defaultValue?: string): string {
  let ret: string;
  if (document) {
    const meta = document.head.querySelector(
      `meta[name='${key}']`,
    ) as HTMLMetaElement;
    ret = meta?.content ?? "";
  } else {
    ret = defaultValue ?? "";
  }

  return ret;
}
