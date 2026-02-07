import { VideoTip } from "@/components/viewer/VideoTips";
import { Stroke, PersonPose } from "@/lib/api";

export interface OpponentContext {
  playerPoses: PersonPose[];
  opponentPoses: PersonPose[];
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
  opponentContext?: OpponentContext,
  playerName?: string
): VideoTip[] {
  const tips: VideoTip[] = [];

  if (!strokes || strokes.length === 0) {
    return tips;
  }

  strokes.forEach((stroke, index) => {
    const contactTime = stroke.peak_frame / fps;

    const contactTip = generateStrokeTip(stroke, index, opponentContext, playerName);
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
 * Get opponent position context for a given stroke
 */
function getOpponentPositionContext(
  strokeIndex: number,
  opponentContext?: OpponentContext
): { hasOpponent: boolean; opponentPosition?: string; distanceContext?: string } {
  if (!opponentContext || opponentContext.opponentPoses.length === 0) {
    return { hasOpponent: false };
  }

  const opponentPose = opponentContext.opponentPoses[strokeIndex];
  if (!opponentPose) {
    return { hasOpponent: false };
  }

  const [x1, , x2] = opponentPose.bbox;
  const centerX = (x1 + x2) / 2;
  const frameWidth = 1920;

  let position = "center";
  if (centerX < frameWidth * 0.33) {
    position = "left side";
  } else if (centerX > frameWidth * 0.67) {
    position = "right side";
  }

  return {
    hasOpponent: true,
    opponentPosition: position,
    distanceContext: "within rally distance",
  };
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
  strokeIndex: number,
  opponentContext?: OpponentContext,
  playerName?: string
): { title: string; message: string } | null {
  const { stroke_type, form_score, metrics } = stroke;
  const strokeName = stroke_type.charAt(0).toUpperCase() + stroke_type.slice(1);
  const prefix = playerName ? `${playerName.split(" ")[0]}'s` : "Your";

  const oppContext = getOpponentPositionContext(strokeIndex, opponentContext);

  // Skip average strokes that don't have any standout issue
  if (form_score >= 75 && form_score <= 85 && !hasNotableIssue(metrics, stroke_type)) {
    return null;
  }

  // Excellent form — positive reinforcement
  if (form_score > 85) {
    const strengths: string[] = [];
    if (metrics.elbow_angle >= 130) strengths.push("full arm extension");
    if (Math.abs(metrics.hip_rotation_range) >= 15) strengths.push("strong hip rotation");
    if (Math.abs(metrics.shoulder_rotation_range) >= 20) strengths.push("good shoulder turn");
    if (metrics.elbow_range >= 50) strengths.push("complete follow-through");

    const detail = strengths.length > 0
      ? strengths.join(" with ")
      : "smooth and well-coordinated";

    return {
      title: `${prefix} ${strokeName} — Excellent`,
      message: oppContext.hasOpponent
        ? `Great shot — ${detail}. Opponent at ${oppContext.opponentPosition}`
        : `Great shot — ${detail}`,
    };
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
