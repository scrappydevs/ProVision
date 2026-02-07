#!/usr/bin/env python3
"""
SAM2 Inference Server for RunPod
Runs on RunPod A100 to provide ball tracking via SAM2.

Usage:
    python sam2_server.py --port 8080

Requirements:
    pip install torch torchvision
    pip install git+https://github.com/facebookresearch/sam2.git
    pip install flask opencv-python numpy
"""

import os
import sys
import argparse
import json
import numpy as np
import cv2
from flask import Flask, request, jsonify
from pathlib import Path

# SAM2 imports (will be available on RunPod)
try:
    import torch
    from sam2.build_sam import build_sam2_video_predictor
    SAM2_AVAILABLE = True
except ImportError:
    SAM2_AVAILABLE = False
    print("WARNING: SAM2 not available. Running in mock mode.")

app = Flask(__name__)

# Global predictor instance
predictor = None
inference_state = None
video_frames = None


def load_sam2_model():
    """Load SAM2 video predictor model."""
    global predictor
    
    if not SAM2_AVAILABLE:
        print("SAM2 not available, using mock predictor")
        return
    
    # SAM2 model checkpoint paths
    sam2_checkpoint = os.getenv("SAM2_CHECKPOINT", "sam2_hiera_large.pt")
    model_cfg = "sam2_hiera_l.yaml"
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading SAM2 model on {device}...")
    
    predictor = build_sam2_video_predictor(model_cfg, sam2_checkpoint, device=device)
    print("SAM2 model loaded successfully")


def extract_video_frames(video_path: str, max_frames: int = 200) -> list:
    """Extract frames from video file."""
    cap = cv2.VideoCapture(video_path)
    frames = []
    
    while len(frames) < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        # Convert BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frames.append(frame_rgb)
    
    cap.release()
    return frames


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "sam2_available": SAM2_AVAILABLE,
        "cuda_available": torch.cuda.is_available() if SAM2_AVAILABLE else False,
    })


@app.route("/init", methods=["POST"])
def init_video():
    """Initialize SAM2 with a video file."""
    global inference_state, video_frames
    
    data = request.json
    video_path = data.get("video_path")
    
    if not video_path or not os.path.exists(video_path):
        return jsonify({"error": "Video file not found"}), 400
    
    # Extract frames
    video_frames = extract_video_frames(video_path)
    
    if not video_frames:
        return jsonify({"error": "Could not extract frames from video"}), 400
    
    if SAM2_AVAILABLE and predictor is not None:
        # Initialize SAM2 inference state
        inference_state = predictor.init_state(video_path=video_path)
    else:
        inference_state = {"mock": True, "frame_count": len(video_frames)}
    
    return jsonify({
        "status": "initialized",
        "frame_count": len(video_frames),
        "frame_size": [video_frames[0].shape[1], video_frames[0].shape[0]],
    })


@app.route("/track", methods=["POST"])
def track_object():
    """Track object from click point through video."""
    global inference_state, video_frames
    
    if inference_state is None or video_frames is None:
        return jsonify({"error": "Video not initialized. Call /init first."}), 400
    
    data = request.json
    x = data.get("x")
    y = data.get("y")
    frame_idx = data.get("frame", 0)
    object_id = data.get("object_id", 1)
    
    if x is None or y is None:
        return jsonify({"error": "x and y coordinates required"}), 400
    
    trajectory = []
    
    if SAM2_AVAILABLE and predictor is not None:
        # Add click point to SAM2
        points = np.array([[x, y]], dtype=np.float32)
        labels = np.array([1], dtype=np.int32)  # 1 = positive click
        
        _, out_obj_ids, out_mask_logits = predictor.add_new_points_or_box(
            inference_state=inference_state,
            frame_idx=frame_idx,
            obj_id=object_id,
            points=points,
            labels=labels,
        )
        
        # Propagate through video
        for frame_idx, obj_ids, masks in predictor.propagate_in_video(inference_state):
            if object_id in obj_ids:
                mask_idx = list(obj_ids).index(object_id)
                mask = masks[mask_idx].cpu().numpy() > 0.5
                
                # Find centroid of mask
                if mask.any():
                    ys, xs = np.where(mask.squeeze())
                    cx, cy = int(xs.mean()), int(ys.mean())
                    confidence = float(masks[mask_idx].max())
                    
                    trajectory.append({
                        "frame": frame_idx,
                        "x": cx,
                        "y": cy,
                        "confidence": confidence,
                    })
    else:
        # Mock trajectory for testing
        for i in range(len(video_frames)):
            # Simulate ball movement
            trajectory.append({
                "frame": i,
                "x": int(x + i * 5 + np.random.randn() * 2),
                "y": int(y - i * 3 + np.random.randn() * 2),
                "confidence": 0.95 - i * 0.001,
            })
    
    # Calculate velocities between frames
    velocities = []
    for i in range(1, len(trajectory)):
        dx = trajectory[i]["x"] - trajectory[i-1]["x"]
        dy = trajectory[i]["y"] - trajectory[i-1]["y"]
        vel = np.sqrt(dx**2 + dy**2)
        velocities.append(round(vel, 2))
    
    # Estimate spin based on trajectory curvature
    spin_estimate = estimate_spin(trajectory) if len(trajectory) > 10 else None
    
    return jsonify({
        "status": "tracked",
        "object_id": object_id,
        "frames": trajectory,
        "velocity": velocities,
        "spin_estimate": spin_estimate,
    })


def estimate_spin(trajectory: list) -> str:
    """Estimate ball spin from trajectory curvature."""
    if len(trajectory) < 10:
        return None
    
    # Calculate vertical acceleration
    y_positions = [t["y"] for t in trajectory[:20]]
    
    # Second derivative approximation
    accelerations = []
    for i in range(2, len(y_positions)):
        acc = y_positions[i] - 2 * y_positions[i-1] + y_positions[i-2]
        accelerations.append(acc)
    
    avg_acc = np.mean(accelerations) if accelerations else 0
    
    if avg_acc > 2:
        return "topspin"
    elif avg_acc < -2:
        return "backspin"
    else:
        return "flat"


@app.route("/reset", methods=["POST"])
def reset():
    """Reset inference state."""
    global inference_state, video_frames
    
    if SAM2_AVAILABLE and predictor is not None and inference_state is not None:
        predictor.reset_state(inference_state)
    
    inference_state = None
    video_frames = None
    
    return jsonify({"status": "reset"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SAM2 Inference Server")
    parser.add_argument("--port", type=int, default=8080, help="Server port")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Server host")
    args = parser.parse_args()
    
    load_sam2_model()
    
    print(f"Starting SAM2 server on {args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=False)
