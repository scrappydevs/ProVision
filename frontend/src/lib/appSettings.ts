const STROKE_DEBUG_MODE_KEY = "provision.settings.stroke_debug_mode";

const hasWindow = () => typeof window !== "undefined";

export const appSettingKeys = {
  strokeDebugMode: STROKE_DEBUG_MODE_KEY,
} as const;

export function readStrokeDebugModeSetting(): boolean {
  if (!hasWindow()) return false;
  try {
    return window.localStorage.getItem(STROKE_DEBUG_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeStrokeDebugModeSetting(enabled: boolean): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(STROKE_DEBUG_MODE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage write failures (private mode / quota / disabled storage)
  }
}
