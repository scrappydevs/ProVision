import { VideoTip } from "@/components/viewer/VideoTips";
import { Stroke } from "@/lib/api";

function isReliableOpponentStroke(stroke: Stroke): boolean {
  const owner = String(stroke.ai_insight_data?.shot_owner ?? stroke.metrics?.event_hitter ?? "").toLowerCase();
  if (owner !== "opponent") return false;

  const method = String(stroke.ai_insight_data?.shot_owner_method ?? stroke.metrics?.event_hitter_method ?? "").toLowerCase();
  const reason = String(stroke.ai_insight_data?.shot_owner_reason ?? stroke.metrics?.event_hitter_reason ?? "").toLowerCase();
  if (method === "proximity_10_percent" && reason.startsWith("player_outside_")) {
    return false;
  }

  const rawConfidence = stroke.ai_insight_data?.shot_owner_confidence ?? stroke.metrics?.event_hitter_confidence;
  const confidence = typeof rawConfidence === "number" ? rawConfidence : Number(rawConfidence);
  return Number.isFinite(confidence) && confidence >= 0.75;
}

function isReliablePlayerStroke(stroke: Stroke): boolean {
  const owner = String(stroke.ai_insight_data?.shot_owner ?? stroke.metrics?.event_hitter ?? "").toLowerCase();
  if (owner === "opponent") return false;
  if (owner === "player") {
    const rawConfidence = stroke.ai_insight_data?.shot_owner_confidence ?? stroke.metrics?.event_hitter_confidence;
    const confidence = typeof rawConfidence === "number" ? rawConfidence : Number(rawConfidence);
    return !Number.isFinite(confidence) || confidence >= 0.55;
  }
  // Legacy rows may not have owner metadata yet; keep them eligible.
  return owner.length === 0;
}

/**
 * Generate coaching tips from strokes — natural language, actionable feedback.
 * Tips are generated for strokes that are notably good, notably weak, or have
 * a clear mechanical issue worth calling out. Average strokes with nothing
 * remarkable are skipped.
 */
export function generateTipsFromStrokes(
  strokes: Stroke[],
  fps: number = 30,
  playerName?: string
): VideoTip[] {
  const tips: VideoTip[] = [];

  if (!strokes || strokes.length === 0) {
    return tips;
  }

  strokes.forEach((stroke) => {
    if (isReliableOpponentStroke(stroke)) return;
    if (!isReliablePlayerStroke(stroke)) return;

    const contactTime = stroke.peak_frame / fps;

    const contactTip = generateStrokeTip(stroke, playerName);
    if (contactTip) {
      tips.push({
        id: `stroke-${stroke.id}-contact`,
        timestamp: contactTime,
        duration: 3.5,
        title: contactTip.title,
        message: contactTip.message,
        strokeId: stroke.id,
        seekTime: stroke.start_frame / fps,
      });
    }
  });

  // Sort by time then enforce minimum 1s spacing — drop later tip if too close
  tips.sort((a, b) => a.timestamp - b.timestamp);
  const spaced: VideoTip[] = [];
  for (const tip of tips) {
    const prev = spaced[spaced.length - 1];
    if (!prev || tip.timestamp - prev.timestamp >= 1.0) {
      spaced.push(tip);
    }
  }
  return spaced;
}

/**
 * Check if an average-form stroke (75-85) has any single metric that stands
 * out enough to warrant a tip. Returns true if something is noteworthy.
 */
function hasNotableIssue(metrics: Stroke["metrics"], strokeType: string): boolean {
  if (metrics.elbow_angle < 120) return true;
  if (Math.abs(metrics.hip_rotation_range) < 10) return true;
  if (metrics.elbow_range < 40) return true;
  if (Math.abs(metrics.shoulder_rotation_range) < 15) return true;
  if (metrics.knee_angle < 130 || metrics.knee_angle > 170) return true;
  if (strokeType === "forehand" && Math.abs(metrics.spine_lean) < 3) return true;
  return false;
}

/**
 * Generate a natural-language coaching tip for a stroke.
 * Returns null for average strokes with nothing notable.
 * Enhanced to provide more specific, varied feedback based on actual metric values.
 */
function generateStrokeTip(
  stroke: Stroke,
  playerName?: string
): { title: string; message: string } | null {
  const { stroke_type, form_score, metrics } = stroke;
  const strokeName = stroke_type.charAt(0).toUpperCase() + stroke_type.slice(1);
  const prefix = playerName ? `${playerName.split(" ")[0]}'s` : "Your";

  // Only show tips for strokes with something to improve
  if (form_score > 85) {
    return null;
  }
  if (form_score >= 75 && form_score <= 85 && !hasNotableIssue(metrics, stroke_type)) {
    return null;
  }

  // Collect all issues with specific values for more varied, data-driven feedback
  const issues: Array<{ priority: number; message: string }> = [];

  // Elbow angle issues (CRITICAL — affects power and consistency)
  if (metrics.elbow_angle < 120) {
    const angle = Math.round(metrics.elbow_angle);
    issues.push({
      priority: 1,
      message: `Your elbow is bent at ${angle}° at contact — extending to 140-150° would increase racket-head speed and generate more ball spin`,
    });
  } else if (metrics.elbow_angle > 165) {
    issues.push({
      priority: 2,
      message: `Your arm is too straight at contact (${Math.round(metrics.elbow_angle)}°) — a slight bend gives better control and reduces injury risk`,
    });
  }

  // Hip rotation (POWER SOURCE)
  const hipRot = Math.abs(metrics.hip_rotation_range);
  if (hipRot < 10) {
    issues.push({
      priority: 1,
      message: `Your hips rotated only ${Math.round(hipRot)}° — increase to 25-35° to drive power from your core into the shot`,
    });
  }

  // Follow-through (CONTROL & SPIN)
  if (metrics.elbow_range < 40) {
    const range = Math.round(metrics.elbow_range);
    issues.push({
      priority: 2,
      message: `Your elbow extends only ${range}° through the swing — a full follow-through (60-80°) keeps the racket accelerating and adds topspin`,
    });
  }

  // Shoulder rotation (UPPER BODY ENGAGEMENT)
  const shoulderRot = Math.abs(metrics.shoulder_rotation_range);
  if (shoulderRot < 15) {
    issues.push({
      priority: 2,
      message: `Your shoulders turned only ${Math.round(shoulderRot)}° — coil more (30-45°) to add pace without extra arm strain`,
    });
  }

  // Knee bend (STANCE & BALANCE)
  if (metrics.knee_angle < 130) {
    issues.push({
      priority: 3,
      message: `You're crouching too low (knee at ${Math.round(metrics.knee_angle)}°) — stand up to 140-150° for quicker recovery and better balance`,
    });
  } else if (metrics.knee_angle > 170) {
    issues.push({
      priority: 2,
      message: `Your stance is too upright (knee at ${Math.round(metrics.knee_angle)}°) — bend to 145-155° for better power transfer and mobility`,
    });
  }

  // Spine lean (WEIGHT TRANSFER — critical for forehand)
  const spineLean = Math.abs(metrics.spine_lean);
  if (stroke_type === "forehand" && spineLean < 3) {
    issues.push({
      priority: 1,
      message: `Your spine is nearly vertical (${Math.round(spineLean)}° lean) — shift your weight forward 8-12° at contact to transfer momentum through the ball`,
    });
  } else if (spineLean > 20) {
    issues.push({
      priority: 1,
      message: `You're leaning too far forward (${Math.round(spineLean)}° spine lean) — this causes rushed contact and mishits. Stay at 8-12° for controlled power`,
    });
  }

  // No notable issues — skip the tip
  if (issues.length === 0) {
    return null;
  }

  // Sort by priority and take the top issue
  issues.sort((a, b) => a.priority - b.priority);
  const primaryIssue = issues[0];

  // Add context from a secondary issue if available for richer feedback
  let message = primaryIssue.message;
  if (issues.length > 1 && issues[1].priority <= 2) {
    const secondaryHint = issues[1].message.split("—")[0].trim(); // Just the observation part
    message = `${primaryIssue.message.split("—")[0].trim()} and ${secondaryHint.toLowerCase()}`;
  }

  return {
    title: `${prefix} ${strokeName}`,
    message,
  };
}
