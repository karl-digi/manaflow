import Store from "electron-store";

export interface AppSettings {
  allowDraftReleases: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  allowDraftReleases: false,
};

let store: Store<AppSettings> | null = null;

export function initializeSettings(): void {
  if (store) return;

  store = new Store<AppSettings>({
    name: "app-settings",
    defaults: DEFAULT_SETTINGS,
    // Enable encryption for additional security
    encryptionKey: "cmux-electron-settings",
  });
}

export function getSettings(): AppSettings {
  if (!store) {
    throw new Error("Settings store not initialized");
  }
  return store.store;
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  if (!store) {
    throw new Error("Settings store not initialized");
  }
  return store.get(key);
}

export function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): void {
  if (!store) {
    throw new Error("Settings store not initialized");
  }
  store.set(key, value);
}

export function updateSettings(settings: Partial<AppSettings>): void {
  if (!store) {
    throw new Error("Settings store not initialized");
  }
  for (const [key, value] of Object.entries(settings)) {
    store.set(key as keyof AppSettings, value as never);
  }
}

export function resetSettings(): void {
  if (!store) {
    throw new Error("Settings store not initialized");
  }
  store.clear();
}
