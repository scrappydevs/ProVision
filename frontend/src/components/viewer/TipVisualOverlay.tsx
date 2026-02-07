"use client";

import { useEffect, useRef } from "react";
import { Stroke } from "@/lib/api";

interface TipVisualOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  activeTipId: string | null;
  stroke: Stroke | null;
  trajectoryData?: any;
  poseData?: any;
  currentFrame: number;
}

export function TipVisualOverlay({
  videoRef,
  activeTipId,
  stroke,
  trajectoryData,
  poseData,
  currentFrame,
}: TipVisualOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const vw = video.videoWidth || 1920;
    const vh = video.videoHeight || 1080;

    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }

    // Clear canvas
    ctx.clearRect(0, 0, vw, vh);

    // Only draw when tip is active
    if (!activeTipId || !stroke) return;

    // Get current pose keypoints
    const currentPose = poseData?.frames?.[currentFrame]?.keypoints;
    if (!currentPose) return;

    // Determine what type of visualization to show based on tip ID
    if (activeTipId.includes("contact")) {
      drawContactAnalysis(ctx, stroke, currentPose, vw, vh);
    } else if (activeTipId.includes("follow")) {
      drawFollowThroughAnalysis(ctx, stroke, currentPose, vw, vh);
    }

    // Draw ball projection if trajectory data available
    if (trajectoryData) {
      drawBallProjection(ctx, trajectoryData, currentFrame, vw, vh);
    }
  }, [videoRef, activeTipId, stroke, trajectoryData, poseData, currentFrame]);

  if (!activeTipId) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 50 }}
    />
  );
}

function drawContactAnalysis(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  keypoints: any,
  vw: number,
  vh: number
) {
  const { metrics } = stroke;

  // Draw elbow angle if it's a key issue
  if (metrics.elbow_angle < 120) {
    const rightElbow = keypoints.right_elbow;
    const rightShoulder = keypoints.right_shoulder;
    const rightWrist = keypoints.right_wrist;

    if (rightElbow && rightShoulder && rightWrist) {
      // Draw arm lines
      ctx.strokeStyle = "rgba(251, 191, 36, 0.8)"; // Amber
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rightShoulder.x, rightShoulder.y);
      ctx.lineTo(rightElbow.x, rightElbow.y);
      ctx.lineTo(rightWrist.x, rightWrist.y);
      ctx.stroke();

      // Draw angle arc
      drawAngleArc(
        ctx,
        rightElbow.x,
        rightElbow.y,
        rightShoulder,
        rightWrist,
        metrics.elbow_angle,
        "rgba(251, 191, 36, 0.6)"
      );

      // Draw angle text
      ctx.fillStyle = "rgba(251, 191, 36, 1)";
      ctx.font = "bold 24px Inter";
      ctx.fillText(`${Math.round(metrics.elbow_angle)}°`, rightElbow.x + 40, rightElbow.y - 20);

      // Draw ideal angle reference
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.font = "16px Inter";
      ctx.fillText("Ideal: 140-160°", rightElbow.x + 40, rightElbow.y + 10);
    }
  }

  // Draw hip rotation indicator
  if (Math.abs(metrics.hip_rotation_range) < 10) {
    const leftHip = keypoints.left_hip;
    const rightHip = keypoints.right_hip;

    if (leftHip && rightHip) {
      const hipCenterX = (leftHip.x + rightHip.x) / 2;
      const hipCenterY = (leftHip.y + rightHip.y) / 2;

      // Draw hip rotation line
      ctx.strokeStyle = "rgba(59, 130, 246, 0.8)"; // Blue
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(leftHip.x, leftHip.y);
      ctx.lineTo(rightHip.x, rightHip.y);
      ctx.stroke();

      // Draw rotation arc indicator
      ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(hipCenterX, hipCenterY, 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw rotation text
      ctx.fillStyle = "rgba(59, 130, 246, 1)";
      ctx.font = "bold 20px Inter";
      ctx.fillText(
        `Hip rotation: ${Math.round(Math.abs(metrics.hip_rotation_range))}°`,
        hipCenterX - 80,
        hipCenterY + 100
      );

      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.font = "16px Inter";
      ctx.fillText("Need 20-40° for power", hipCenterX - 80, hipCenterY + 125);
    }
  }

  // Draw spine lean / weight transfer
  const nose = keypoints.nose;
  const midHip = keypoints.left_hip && keypoints.right_hip
    ? {
        x: (keypoints.left_hip.x + keypoints.right_hip.x) / 2,
        y: (keypoints.left_hip.y + keypoints.right_hip.y) / 2,
      }
    : null;

  if (nose && midHip && Math.abs(metrics.spine_lean) < 3) {
    // Draw spine line
    ctx.strokeStyle = "rgba(155, 123, 91, 0.8)"; // Bronze
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(nose.x, nose.y);
    ctx.lineTo(midHip.x, midHip.y);
    ctx.stroke();

    // Draw vertical reference
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(midHip.x, nose.y);
    ctx.lineTo(midHip.x, midHip.y + 50);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw lean angle
    ctx.fillStyle = "rgba(155, 123, 91, 1)";
    ctx.font = "bold 20px Inter";
    ctx.fillText(
      `Lean: ${Math.round(Math.abs(metrics.spine_lean))}°`,
      midHip.x + 50,
      midHip.y - 20
    );

    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.font = "16px Inter";
    ctx.fillText("Lean forward 5-15°", midHip.x + 50, midHip.y + 5);
  }
}

function drawFollowThroughAnalysis(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  keypoints: any,
  vw: number,
  vh: number
) {
  const { metrics } = stroke;

  // Draw follow-through path indicator
  const rightWrist = keypoints.right_wrist;
  const rightElbow = keypoints.right_elbow;
  const rightShoulder = keypoints.right_shoulder;

  if (rightWrist && rightElbow && rightShoulder) {
    // Draw arm extension
    ctx.strokeStyle = "rgba(16, 185, 129, 0.8)"; // Green
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(rightShoulder.x, rightShoulder.y);
    ctx.lineTo(rightElbow.x, rightElbow.y);
    ctx.lineTo(rightWrist.x, rightWrist.y);
    ctx.stroke();

    // Draw extension arc showing range of motion
    const extensionArc = metrics.elbow_range;
    ctx.strokeStyle = "rgba(16, 185, 129, 0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(rightElbow.x, rightElbow.y, 80, 0, (extensionArc * Math.PI) / 180);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw range text
    ctx.fillStyle = "rgba(16, 185, 129, 1)";
    ctx.font = "bold 22px Inter";
    ctx.fillText(
      `Extension: ${Math.round(extensionArc)}°`,
      rightWrist.x + 30,
      rightWrist.y - 20
    );

    if (extensionArc < 40) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.font = "16px Inter";
      ctx.fillText("Need 50-70° for full follow-through", rightWrist.x + 30, rightWrist.y + 10);
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.font = "16px Inter";
      ctx.fillText("✓ Good extension", rightWrist.x + 30, rightWrist.y + 10);
    }
  }
}

function drawBallProjection(
  ctx: CanvasRenderingContext2D,
  trajectoryData: any,
  currentFrame: number,
  vw: number,
  vh: number
) {
  const points = trajectoryData?.trajectory || [];
  if (points.length === 0) return;

  // Find current ball position
  const currentPoint = points.find((p: any) => p.frame === currentFrame);
  if (!currentPoint) return;

  // Find next 10-15 frames to project trajectory
  const futurePoints = points
    .filter((p: any) => p.frame > currentFrame && p.frame <= currentFrame + 15)
    .slice(0, 10);

  if (futurePoints.length < 2) return;

  // Draw current ball position (larger highlight)
  ctx.fillStyle = "rgba(34, 197, 94, 0.9)";
  ctx.beginPath();
  ctx.arc(currentPoint.x, currentPoint.y, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(currentPoint.x, currentPoint.y, 12, 0, Math.PI * 2);
  ctx.stroke();

  // Draw projected path
  ctx.strokeStyle = "rgba(34, 197, 94, 0.6)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(currentPoint.x, currentPoint.y);
  futurePoints.forEach((p: any) => {
    ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw projected landing position
  const landingPoint = futurePoints[futurePoints.length - 1];
  ctx.fillStyle = "rgba(34, 197, 94, 0.4)";
  ctx.beginPath();
  ctx.arc(landingPoint.x, landingPoint.y, 20, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(34, 197, 94, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(landingPoint.x, landingPoint.y, 20, 0, Math.PI * 2);
  ctx.stroke();

  // Draw "projected landing" label
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.font = "bold 16px Inter";
  ctx.fillText("Ball landing", landingPoint.x - 50, landingPoint.y + 45);
}

function drawAngleArc(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  point1: { x: number; y: number },
  point2: { x: number; y: number },
  angle: number,
  color: string
) {
  const angle1 = Math.atan2(point1.y - centerY, point1.x - centerX);
  const angle2 = Math.atan2(point2.y - centerY, point2.x - centerX);

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 50, angle1, angle2);
  ctx.stroke();
}
