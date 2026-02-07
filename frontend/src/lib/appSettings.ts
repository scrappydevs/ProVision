const STROKE_DEBUG_MODE_KEY = "provision.settings.stroke_debug_mode";
const STROKE_CLAUDE_CLASSIFIER_KEY = "provision.settings.stroke_claude_classifier";

const hasWindow = () => typeof window !== "undefined";

export const appSettingKeys = {
  strokeDebugMode: STROKE_DEBUG_MODE_KEY,
  strokeClaudeClassifier: STROKE_CLAUDE_CLASSIFIER_KEY,
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

export function readStrokeClaudeClassifierEnabledSetting(): boolean {
  if (!hasWindow()) return true;
  try {
    const v = window.localStorage.getItem(STROKE_CLAUDE_CLASSIFIER_KEY);
    return v === null || v === "true";
  } catch {
    return true;
  }
}

export function writeStrokeClaudeClassifierEnabledSetting(enabled: boolean): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(STROKE_CLAUDE_CLASSIFIER_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage write failures
  }
}
