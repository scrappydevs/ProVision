import { VideoTip } from "@/components/viewer/VideoTips";
import { Stroke } from "@/lib/api";

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

  // Priority issues — find the most important thing to fix

  if (metrics.elbow_angle < 120) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Extend your arm more at contact — a longer lever creates more racket-head speed through the ball`,
    };
  }

  const hipRot = Math.abs(metrics.hip_rotation_range);
  if (hipRot < 10) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Rotate your hips more into the shot — the pelvis drives the kinetic chain for power transfer`,
    };
  }

  if (metrics.elbow_range < 40) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Finish the swing — a full follow-through keeps the racket accelerating and adds topspin control`,
    };
  }

  const shoulderRot = Math.abs(metrics.shoulder_rotation_range);
  if (shoulderRot < 15) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Turn your shoulders more through the shot — upper-body torque adds pace without extra arm effort`,
    };
  }

  if (metrics.knee_angle < 130) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `You're crouching too low — stand up slightly for better balance and quicker recovery between shots`,
    };
  }

  if (metrics.knee_angle > 170) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Bend your knees more — a lower stance gives you faster lateral movement and better weight transfer`,
    };
  }

  if (stroke_type === "forehand" && Math.abs(metrics.spine_lean) < 3) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Shift your weight forward through the ball — leaning into contact transfers more momentum`,
    };
  }

  // Weak form with no single standout issue — general guidance
  return {
    title: `${prefix} ${strokeName}`,
    message: `Focus on connecting the chain — drive from legs through hips and torso into the racket`,
  };
}
