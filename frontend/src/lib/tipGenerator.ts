import { VideoTip } from "@/components/viewer/VideoTips";
import { Stroke, PersonPose } from "@/lib/api";

export interface OpponentContext {
  playerPoses: PersonPose[];
  opponentPoses: PersonPose[];
}

/**
 * Generate focused coaching tips - one tip per stroke showing the most important feedback
 * Now includes opponent positioning context for more comprehensive analysis
 * playerName is used to clarify tips are about the selected player (not opponent)
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

  // Generate tips only for significant strokes (excellent or needs improvement)
  strokes.forEach((stroke, index) => {
    const strokeDuration = (stroke.end_frame - stroke.start_frame) / fps;
    const contactTime = stroke.peak_frame / fps;

    // Only generate tips for strokes that need attention (poor) or deserve praise (excellent)
    // Skip "okay" strokes (form_score 75-85) to reduce noise
    const shouldGenerateTip = stroke.form_score < 75 || stroke.form_score > 85;

    if (!shouldGenerateTip) {
      return; // Skip this stroke
    }

    // Main contact tip (primary technique feedback with opponent context)
    const contactTip = generateStrokeTip(stroke, index, opponentContext, playerName);
    if (contactTip) {
      tips.push({
        id: `stroke-${stroke.id}-contact`,
        timestamp: contactTime,
        duration: 5.5, // Enough time to read while video plays
        title: contactTip.title,
        message: contactTip.message,
        strokeId: stroke.id,
        seekTime: stroke.start_frame / fps,
      });
    }
  });

  return tips.sort((a, b) => a.timestamp - b.timestamp);
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

  // Get the opponent pose for this stroke (strokeIndex maps to pose arrays)
  const opponentPose = opponentContext.opponentPoses[strokeIndex];
  if (!opponentPose) {
    return { hasOpponent: false };
  }

  // Analyze opponent bbox to determine position
  const [x1, y1, x2, y2] = opponentPose.bbox;
  const centerX = (x1 + x2) / 2;
  const frameWidth = 1920; // Typical video width

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
 * Generate contact phase tip (main technique feedback)
 * Now includes opponent positioning context for tactical insights
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

  // Get opponent context for this stroke
  const oppContext = getOpponentPositionContext(strokeIndex, opponentContext);

  // Priority 1: If form is excellent, give positive reinforcement with opponent context
  if (form_score > 85) {
    const baseMessage = `Excellent kinetic chain - strong power transfer`;
    const contextualMessage = oppContext.hasOpponent
      ? `${baseMessage}. Opponent at ${oppContext.opponentPosition}`
      : baseMessage;

    return {
      title: `${prefix} ${strokeName} - Excellent`,
      message: contextualMessage,
    };
  }

  // Priority 2: Critical technique issues (most important to fix first)

  // Elbow extension at contact (crucial for power and control)
  if (metrics.elbow_angle < 120) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Extend arm more at contact for better power`,
    };
  }

  // Hip rotation (power generation)
  const hipRotRange = Math.abs(metrics.hip_rotation_range);
  if (hipRotRange < 10) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Rotate hips more to generate power`,
    };
  }

  // Follow-through completion
  if (metrics.elbow_range < 40) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Complete the follow-through`,
    };
  }

  // Shoulder rotation (coordination with hips)
  const shoulderRotRange = Math.abs(metrics.shoulder_rotation_range);
  if (shoulderRotRange < 15) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Increase shoulder rotation`,
    };
  }

  // Knee bend (athletic stance)
  if (metrics.knee_angle < 130) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Stance too low - raise slightly for mobility`,
    };
  } else if (metrics.knee_angle > 170) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Bend knees more for better balance`,
    };
  }

  // Weight transfer (spine lean)
  const spineLean = Math.abs(metrics.spine_lean);
  if (stroke_type === "forehand" && spineLean < 3) {
    return {
      title: `${prefix} ${strokeName}`,
      message: `Transfer weight forward into the shot`,
    };
  }

  // Priority 3: Needs significant work
  return {
    title: `${prefix} ${strokeName}`,
    message: `Focus on coordinating legs → hips → shoulders → arm`,
  };
}

