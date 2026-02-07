import { VideoTip } from "@/components/viewer/VideoTips";
import { Stroke } from "@/lib/api";

/**
 * Generate focused coaching tips - one tip per stroke showing the most important feedback
 */
export function generateTipsFromStrokes(strokes: Stroke[], fps: number = 30): VideoTip[] {
  const tips: VideoTip[] = [];

  if (!strokes || strokes.length === 0) {
    return tips;
  }

  // Generate tips for each stroke - spaced out to avoid overlap
  strokes.forEach((stroke, index) => {
    const strokeDuration = (stroke.end_frame - stroke.start_frame) / fps;
    const contactTime = stroke.peak_frame / fps;

    // Main contact tip (primary technique feedback)
    const contactTip = generateStrokeTip(stroke);
    if (contactTip) {
      tips.push({
        id: `stroke-${stroke.id}-contact`,
        timestamp: contactTime,
        duration: 2.8,
        title: contactTip.title,
        message: contactTip.message,
        strokeId: stroke.id,
        seekTime: stroke.start_frame / fps,
      });
    }

    // Add follow-through tip only if it's a significant issue or excellent shot
    const followTip = generateFollowThroughTip(stroke);
    if (followTip && shouldShowFollowThroughTip(stroke)) {
      // Only show if there's enough time before next stroke
      const nextStroke = strokes[index + 1];
      const timeUntilNext = nextStroke
        ? (nextStroke.start_frame / fps) - (stroke.end_frame / fps)
        : 999;

      if (timeUntilNext > 1.5) {
        tips.push({
          id: `stroke-${stroke.id}-follow`,
          timestamp: stroke.end_frame / fps + 0.3,
          duration: 2.5,
          title: followTip.title,
          message: followTip.message,
          strokeId: stroke.id,
          seekTime: stroke.start_frame / fps,
        });
      }
    }
  });

  // Add rally summary at the end
  if (strokes.length > 0) {
    const lastStroke = strokes[strokes.length - 1];
    const forehandCount = strokes.filter(s => s.stroke_type === "forehand").length;
    const backhandCount = strokes.filter(s => s.stroke_type === "backhand").length;

    tips.push({
      id: "rally-summary",
      timestamp: lastStroke.end_frame / fps + 1.0,
      duration: 3.0,
      title: "Rally complete",
      message: `${strokes.length} shot${strokes.length > 1 ? 's' : ''} | FH:BH ${forehandCount}:${backhandCount}`,
    });
  }

  return tips.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Check if follow-through tip should be shown (only for significant issues or excellent shots)
 */
function shouldShowFollowThroughTip(stroke: Stroke): boolean {
  const { form_score, metrics } = stroke;

  // Show for excellent shots
  if (form_score > 85) return true;

  // Show if follow-through is significantly incomplete
  if (metrics.elbow_range < 35) return true;

  // Show if shoulder rotation is very limited
  const shoulderRotRange = Math.abs(metrics.shoulder_rotation_range);
  if (shoulderRotRange < 20) return true;

  return false;
}

/**
 * Generate contact phase tip (main technique feedback)
 */
function generateStrokeTip(stroke: Stroke): { title: string; message: string } | null {
  const { stroke_type, form_score, metrics } = stroke;
  const strokeName = stroke_type.charAt(0).toUpperCase() + stroke_type.slice(1);

  // Priority 1: If form is excellent, give positive reinforcement
  if (form_score > 85) {
    return {
      title: `Excellent ${strokeName}`,
      message: `Great kinetic chain coordination - you're efficiently transferring energy from legs through core to racket`,
    };
  }

  // Priority 2: Critical technique issues (most important to fix first)

  // Elbow extension at contact (crucial for power and control)
  if (metrics.elbow_angle < 120) {
    return {
      title: strokeName,
      message: `Extend arm more at contact - a straighter arm creates a longer lever, increasing racket speed and control`,
    };
  }

  // Hip rotation (power generation)
  const hipRotRange = Math.abs(metrics.hip_rotation_range);
  if (hipRotRange < 10) {
    return {
      title: strokeName,
      message: `Rotate hips more - hip rotation transfers energy from your legs and core into the shot, generating more power`,
    };
  }

  // Follow-through completion
  if (metrics.elbow_range < 40) {
    return {
      title: strokeName,
      message: `Complete the follow-through - this ensures full energy transfer and helps control ball spin and direction`,
    };
  }

  // Shoulder rotation (coordination with hips)
  const shoulderRotRange = Math.abs(metrics.shoulder_rotation_range);
  if (shoulderRotRange < 15) {
    return {
      title: strokeName,
      message: `Use more shoulder turn - shoulder rotation works with hip rotation to maximize the kinetic chain effect`,
    };
  }

  // Knee bend (athletic stance)
  if (metrics.knee_angle < 130) {
    return {
      title: strokeName,
      message: `Stance too low - slightly higher stance allows quicker weight transfer and better mobility between shots`,
    };
  } else if (metrics.knee_angle > 170) {
    return {
      title: strokeName,
      message: `Bend knees more - lower center of gravity improves balance and lets you generate power from your legs`,
    };
  }

  // Weight transfer (spine lean)
  const spineLean = Math.abs(metrics.spine_lean);
  if (stroke_type === "forehand" && spineLean < 3) {
    return {
      title: strokeName,
      message: `Lean forward into the shot - weight transfer from back foot to front foot adds momentum to your stroke`,
    };
  }

  // Priority 3: Good form - show encouraging feedback with one area to refine
  if (form_score > 70) {
    // Find one thing to improve
    if (hipRotRange < 25 && hipRotRange >= 10) {
      return {
        title: `Good ${strokeName}`,
        message: `Solid form - increasing hip rotation further will add more power without sacrificing control`,
      };
    }
    if (shoulderRotRange < 30 && shoulderRotRange >= 15) {
      return {
        title: `Good ${strokeName}`,
        message: `Strong technique - extend shoulder turn through finish to maximize spin potential`,
      };
    }
    return {
      title: `Good ${strokeName}`,
      message: `Well-coordinated stroke - your body segments are working together efficiently`,
    };
  }

  // Priority 4: Needs significant work
  return {
    title: strokeName,
    message: `Focus on fundamentals - work on coordinating your kinetic chain from legs → hips → shoulders → arm`,
  };
}

/**
 * Generate follow-through phase tip
 */
function generateFollowThroughTip(stroke: Stroke): { title: string; message: string } | null {
  const { stroke_type, metrics } = stroke;
  const strokeName = stroke_type.charAt(0).toUpperCase() + stroke_type.slice(1);

  // Check follow-through completion
  if (metrics.elbow_range < 40) {
    return {
      title: `${strokeName} finish`,
      message: `Incomplete follow-through - extend fully to maximize spin and control`,
    };
  }

  const shoulderRotRange = Math.abs(metrics.shoulder_rotation_range);
  if (shoulderRotRange < 30) {
    return {
      title: `${strokeName} finish`,
      message: `Finish with full shoulder rotation - this adds topspin and stability`,
    };
  }

  // Good follow-through
  if (metrics.elbow_range > 60 && shoulderRotRange > 30) {
    return {
      title: `${strokeName} finish`,
      message: `Excellent follow-through - complete extension gives you maximum control`,
    };
  }

  return {
    title: `${strokeName} finish`,
    message: `Good finish - maintaining extension helps with shot consistency`,
  };
}
