import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { check } from "@tauri-apps/plugin-updater";

export function isDesktopAppRuntime() {
  return typeof window !== "undefined" && isTauri();
}

export {
  check as checkForAppUpdate,
  invoke as tauriInvoke,
  isPermissionGranted as isNotificationPermissionGranted,
  listen as tauriListen,
  requestPermission as requestNotificationPermission,
  save as saveWithDialog,
  sendNotification,
  writeClipboardText,
  writeFile,
  writeTextFile,
};
