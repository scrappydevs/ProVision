#!/usr/bin/env python3
"""
FastAPI Persistent Model Server for ProVision

USAGE:
    python model_server.py --port 8765 --models sam2,sam3d

ENDPOINTS:
    GET  /health           - Server status
    POST /sam2/init        - Initialize SAM2 with video
    POST /sam2/track       - SAM2 object tracking
    POST /sam3d/segment    - SAM3D 3D point cloud segmentation
    GET  /sam3d/status     - Check SAM3D processing status
"""

import os
import sys
import time
import signal
import asyncio
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List
from contextlib import asynccontextmanager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("model_server")

# FastAPI imports
try:
    from fastapi import FastAPI, APIRouter, HTTPException, status, BackgroundTasks
    from fastapi.responses import JSONResponse
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field
    import uvicorn
except ImportError:
    logger.error("FastAPI not installed. Run: pip install fastapi uvicorn pydantic")
    sys.exit(1)


# ============================================================================
# Configuration
# ============================================================================

class ServerConfig:
    """Server configuration from environment variables."""
    
    def __init__(self):
        self.port = int(os.getenv("MODEL_SERVER_PORT", "8765"))
        self.host = os.getenv("MODEL_SERVER_HOST", "0.0.0.0")
        
        # Model paths
        self.sam2_path = os.getenv("SAM2_MODEL_PATH", "/workspace/checkpoints/sam2.1_hiera_tiny.pt")
        self.sam2_config = os.getenv("SAM2_CONFIG", "configs/sam2.1/sam2.1_hiera_t.yaml")
        self.sam3d_path = os.getenv("SAM3D_MODEL_PATH", "/workspace/checkpoints/sam3d/")
        self.tracknet_path = os.getenv("TRACKNET_MODEL_PATH", "/workspace/checkpoints/tracknet_tennis.pt")
        self.tracknet_dir = os.getenv("TRACKNET_DIR", "/workspace/provision/tracknet")
        self.ttnet_path = os.getenv("TTNET_MODEL_PATH", "/workspace/checkpoints/ttnet_3rd_phase.pth")
        self.ttnet_dir = os.getenv("TTNET_DIR", "/workspace/provision/ttnet")
        self.ttnet_input_size = (320, 128)  # (w, h) as per TTNet paper
        self.ttnet_num_frames = 9  # 9 consecutive frames
        
        # Working directories
        self.sam2_dir = os.getenv("SAM2_WORKING_DIR", "/workspace/codes/sam2")
        self.sam3d_dir = os.getenv("SAM3D_WORKING_DIR", "/workspace/codes/sam3d")
        
        # Data directories
        self.data_dir = os.getenv("REMOTE_BASE_DIR", "/workspace/provision/data")
        self.results_dir = os.getenv("REMOTE_RESULTS_DIR", "/workspace/provision/data/results")
        
        # Models to load
        self.models_to_load = os.getenv("LOAD_MODELS", "sam2").split(",")


config = ServerConfig()


# ============================================================================
# Model Registry (Global State)
# ============================================================================

class ModelRegistry:
    """Thread-safe registry for loaded ML models."""
    
    def __init__(self):
        self.models: Dict[str, Any] = {}
        self.load_times: Dict[str, float] = {}
        self.device = "cpu"
        self._initialized = False
        self._shutting_down = False
    
    def get(self, name: str) -> Optional[Any]:
        return self.models.get(name)
    
    def set(self, name: str, model: Any, load_time: float):
        self.models[name] = model
        self.load_times[name] = load_time
    
    def is_loaded(self, name: str) -> bool:
        return name in self.models
    
    def list_models(self) -> List[str]:
        return list(self.models.keys())
    
    def get_status(self) -> Dict[str, Any]:
        return {
            "initialized": self._initialized,
            "device": self.device,
            "models": {
                name: {
                    "loaded": True,
                    "load_time_seconds": self.load_times.get(name, 0)
                }
                for name in self.models
            }
        }


registry = ModelRegistry()


# ============================================================================
# Model Loaders
# ============================================================================

def load_sam2_model(model_path: str, config_path: str, working_dir: str):
    """Load SAM2 model for video object tracking."""
    logger.info(f"Loading SAM2 model from {model_path}")
    start_time = time.time()
    
    try:
        # Add SAM2 to path
        sys.path.insert(0, working_dir)
        os.chdir(working_dir)
        
        import torch
        from sam2.build_sam import build_sam2_video_predictor
        
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        registry.device = device
        
        predictor = build_sam2_video_predictor(config_path, model_path, device=device)
        
        load_time = time.time() - start_time
        logger.info(f"SAM2 loaded in {load_time:.2f}s on {device}")
        
        return predictor, load_time
    
    except Exception as e:
        logger.error(f"Failed to load SAM2: {e}")
        raise


def load_sam3d_model(model_dir: str, working_dir: str):
    """Load SAM3D model for 3D point cloud segmentation."""
    logger.info(f"Loading SAM3D from {model_dir}")
    start_time = time.time()
    
    try:
        # Add SAM3D to path
        sys.path.insert(0, working_dir)
        os.chdir(working_dir)
        
        import torch
        
        # SAM3D uses SAM as a component - we mainly need depth estimation
        # The actual 3D projection is done in the processing pipeline
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        
        # Load MiDaS for depth estimation
        midas = torch.hub.load("intel-isl/MiDaS", "DPT_Large")
        midas.to(device)
        midas.eval()
        
        # Load MiDaS transforms
        midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
        transform = midas_transforms.dpt_transform
        
        load_time = time.time() - start_time
        logger.info(f"SAM3D (MiDaS depth) loaded in {load_time:.2f}s on {device}")
        
        return {"midas": midas, "transform": transform, "device": device}, load_time
    
    except Exception as e:
        logger.error(f"Failed to load SAM3D: {e}")
        raise


def load_tracknet_model(model_path: str, tracknet_dir: str):
    """Load TrackNet model for ball tracking via temporal heatmaps."""
    logger.info(f"Loading TrackNet from {model_path}")
    start_time = time.time()
    
    try:
        sys.path.insert(0, tracknet_dir)
        import torch
        from model import BallTrackerNet
        
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        registry.device = device  # Update global device for inference
        model = BallTrackerNet()
        model.load_state_dict(torch.load(model_path, map_location=device))
        model = model.to(device)
        model.eval()
        
        # Warm up
        dummy = torch.rand(1, 9, 360, 640).to(device)
        with torch.no_grad():
            model(dummy, testing=True)
        
        load_time = time.time() - start_time
        logger.info(f"TrackNet loaded in {load_time:.2f}s on {device}")
        return model, load_time
    
    except Exception as e:
        logger.error(f"Failed to load TrackNet: {e}")
        raise


def load_ttnet_model(model_path: str, ttnet_dir: str):
    """Load TTNet model for table-tennis-specific ball tracking.
    
    TTNet (CVPR 2020) uses 9 consecutive frames and a two-stage architecture:
    - Global stage: coarse ball position from full frame
    - Local stage: refined position from cropped region
    Also supports event spotting (bounce/net) and segmentation.
    
    Setup:
        git clone https://github.com/maudzung/TTNet-Real-time-Analysis-System-for-Table-Tennis-Pytorch /workspace/provision/ttnet
        # Download pretrained weights to /workspace/checkpoints/ttnet_3rd_phase.pth
    """
    logger.info(f"Loading TTNet from {model_path}")
    start_time = time.time()
    
    try:
        sys.path.insert(0, os.path.join(ttnet_dir, "src"))
        sys.path.insert(0, os.path.join(ttnet_dir, "src", "models"))
        sys.path.insert(0, ttnet_dir)
        import torch
        from TTNet import TTNet
        
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        
        # Load model with global + local stages for best ball detection
        tasks = ["global", "local", "event"]
        model = TTNet(
            dropout_p=0.5,
            tasks=tasks,
            input_size=config.ttnet_input_size,
            thresh_ball_pos_mask=0.01,
            num_frames_sequence=config.ttnet_num_frames,
        )
        
        checkpoint = torch.load(model_path, map_location=device)
        if "state_dict" in checkpoint:
            model.load_state_dict(checkpoint["state_dict"])
        else:
            model.load_state_dict(checkpoint)
        
        model = model.to(device)
        model.eval()
        
        # Warm up
        dummy = torch.rand(1, 27, 128, 320).to(device)  # 9 frames * 3 channels
        dummy_pos = torch.tensor([[-1.0, -1.0]]).to(device)
        with torch.no_grad():
            model(dummy, dummy_pos)
        
        load_time = time.time() - start_time
        logger.info(f"TTNet loaded in {load_time:.2f}s on {device}")
        return model, load_time
    
    except Exception as e:
        logger.error(f"Failed to load TTNet: {e}")
        raise


# ============================================================================
# Request/Response Models
# ============================================================================

class HealthResponse(BaseModel):
    status: str = "ok"
    uptime_seconds: float
    models: Dict[str, Any]
    device: str


class SAM2InitRequest(BaseModel):
    session_id: str
    video_path: str


class SAM2TrackRequest(BaseModel):
    session_id: str
    video_path: str
    init_point: Dict[str, float] = Field(default_factory=dict, description="Point with x, y coordinates")
    frame: int = 0
    detection_box: Optional[List[float]] = Field(default=None, description="YOLO bbox [x1,y1,x2,y2] for direct SAM2 box prompt")


class SAM2TrackResponse(BaseModel):
    session_id: str
    status: str
    trajectory: Optional[List[Dict[str, Any]]] = None
    masks_dir: Optional[str] = None
    error: Optional[str] = None


class SAM3DSegmentRequest(BaseModel):
    session_id: str
    object_id: str
    video_path: str
    masks_dir: str
    start_frame: int = 0
    end_frame: Optional[int] = None


class SAM3DSegmentResponse(BaseModel):
    session_id: str
    object_id: str
    status: str
    job_id: Optional[str] = None
    point_cloud_path: Optional[str] = None
    error: Optional[str] = None


# ============================================================================
# Job Tracking
# ============================================================================

class JobTracker:
    """Track background processing jobs."""
    
    def __init__(self):
        self.jobs: Dict[str, Dict[str, Any]] = {}
    
    def create_job(self, job_type: str, session_id: str, **kwargs) -> str:
        import uuid
        job_id = str(uuid.uuid4())
        self.jobs[job_id] = {
            "id": job_id,
            "type": job_type,
            "session_id": session_id,
            "status": "processing",
            "created_at": datetime.now().isoformat(),
            "completed_at": None,
            "result": None,
            "error": None,
            **kwargs
        }
        return job_id
    
    def update_job(self, job_id: str, **kwargs):
        if job_id in self.jobs:
            self.jobs[job_id].update(kwargs)
    
    def complete_job(self, job_id: str, result: Any):
        if job_id in self.jobs:
            self.jobs[job_id].update({
                "status": "completed",
                "completed_at": datetime.now().isoformat(),
                "result": result
            })
    
    def fail_job(self, job_id: str, error: str):
        if job_id in self.jobs:
            self.jobs[job_id].update({
                "status": "failed",
                "completed_at": datetime.now().isoformat(),
                "error": error
            })
    
    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self.jobs.get(job_id)


job_tracker = JobTracker()


# ============================================================================
# Processing Functions
# ============================================================================

async def process_sam2_tracking(
    session_id: str,
    video_path: str,
    init_point: Dict[str, float],
    frame: int,
    detection_box: Optional[List[float]] = None
) -> Dict[str, Any]:
    """
    Process SAM2 object tracking with optimized frame extraction pattern.
    
    Key steps:
    1. Extract only frames starting from click frame (re-indexed to 0)
    2. Use add_new_points with frame_idx=0 (not add_new_points_or_box)
    3. No torch.autocast (can cause precision loss for small objects like ping pong balls)
    4. Map frame indices back to actual video frame numbers
    """
    import torch
    import numpy as np
    import cv2
    import tempfile
    import shutil
    
    predictor = registry.get("sam2")
    if predictor is None:
        raise HTTPException(status_code=503, detail="SAM2 model not loaded")
    
    output_dir = f"{config.results_dir}/{session_id}/sam2"
    os.makedirs(output_dir, exist_ok=True)
    
    # Step 1: Extract frames starting from click frame
    frames_dir = tempfile.mkdtemp(prefix="sam2_frames_")
    logger.info(f"Extracting frames from {video_path} starting at frame {frame}")
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open video: {video_path}")
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    # Start extraction from the click frame
    actual_start = max(0, frame)
    cap.set(cv2.CAP_PROP_POS_FRAMES, actual_start)
    
    extracted = 0
    for real_frame_idx in range(actual_start, total_video_frames):
        ret, frame_img = cap.read()
        if not ret:
            break
        # Save with sequential 0-indexed names (SAM2 expects this)
        frame_path = os.path.join(frames_dir, f"{extracted:05d}.jpeg")
        cv2.imwrite(frame_path, frame_img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        extracted += 1
    cap.release()
    
    logger.info(f"Extracted {extracted} frames (from frame {actual_start}, {width}x{height} @ {fps:.1f}fps)")
    
    # Step 2: Run SAM2 tracking
    trajectory = []
    
    try:
        with torch.inference_mode():
            # Initialize with frames directory
            inference_state = predictor.init_state(video_path=frames_dir)
            
            # Add prompts on frame 0 (which corresponds to actual_start in the video)
            predictor.reset_state(inference_state)
            
            # CRITICAL: SAM2 coordinate handling for non-square videos:
            # - normalize_coords=False is broken in this build (missing _C.so symbol)
            # - normalize_coords=True divides by (video_w, video_h) then scales to 1024
            # - But SAM2 internally resizes preserving aspect ratio (scale = 1024/max(w,h))
            # - For non-square videos, this causes y-coordinate mismatch
            # FIX: Scale pixel coords by (dim/max_dim) before passing with normalize_coords=True
            # Output masks also need inverse scaling to get back to pixel coords
            longest = max(width, height)
            
            def pixel_to_sam2(px, py):
                """Convert pixel coords to SAM2 internal coords for normalize_coords=True."""
                return px * width / longest, py * height / longest
            
            def sam2_to_pixel(sx, sy):
                """Convert SAM2 internal mask coords back to pixel coords."""
                return sx * longest / width, sy * longest / height
            
            if detection_box and len(detection_box) == 4:
                bx1, by1, bx2, by2 = detection_box
                sx1, sy1 = pixel_to_sam2(bx1, by1)
                sx2, sy2 = pixel_to_sam2(bx2, by2)
                box = np.array([sx1, sy1, sx2, sy2], dtype=np.float32)
                cx, cy = pixel_to_sam2((bx1+bx2)/2, (by1+by2)/2)
                box_h_sam = sy2 - sy1
                neg_y = min(cy + max(box_h_sam * 3, 30), height * height / longest - 1)
                points = np.array([[cx, cy], [cx, neg_y]], dtype=np.float32)
                labels = np.array([1, 0], dtype=np.int32)
                logger.info(f"YOLO bbox -> SAM2 coords: box={box.tolist()}")
            else:
                x, y = init_point.get("x", 0), init_point.get("y", 0)
                sx, sy = pixel_to_sam2(x, y)
                box_half = 25 * min(width, height) / longest
                box = np.array([
                    max(0, sx - box_half), max(0, sy - box_half),
                    min(width * width / longest, sx + box_half),
                    min(height * height / longest, sy + box_half),
                ], dtype=np.float32)
                neg_y = min(sy + box_half * 3, height * height / longest - 1)
                points = np.array([[sx, sy], [sx, neg_y]], dtype=np.float32)
                labels = np.array([1, 0], dtype=np.int32)
                logger.info(f"Manual click -> SAM2 coords: ({sx:.1f},{sy:.1f})")
            
            predictor.add_new_points_or_box(
                inference_state=inference_state,
                frame_idx=0,
                obj_id=1,
                points=points,
                labels=labels,
                box=box,
                normalize_coords=True,
            )
            
            # Propagate through all extracted frames
            for local_frame_idx, obj_ids, mask_logits in predictor.propagate_in_video(inference_state):
                actual_frame_idx = actual_start + local_frame_idx
                
                if mask_logits is not None and len(mask_logits) > 0:
                    # SAM2 returns raw logits — threshold at 0.0 for binary mask
                    # but use sigmoid(max_logit) as actual confidence score
                    raw_logits = mask_logits[0]
                    mask = (raw_logits > 0.0).cpu().numpy()
                    if mask.ndim == 3:
                        mask = mask.squeeze()
                    
                    ys, xs = np.where(mask)
                    
                    if len(xs) > 0:
                        # Compute real confidence: sigmoid of the max logit value
                        max_logit = float(raw_logits.max().cpu())
                        confidence = 1.0 / (1.0 + np.exp(-max_logit))  # sigmoid
                        
                        # SAM2 mask coords are in internal space — convert back to pixel coords
                        raw_cx, raw_cy = float(np.mean(xs)), float(np.mean(ys))
                        px_cx, px_cy = sam2_to_pixel(raw_cx, raw_cy)
                        cx, cy = px_cx, px_cy
                        
                        raw_bbox = [int(np.min(xs)), int(np.min(ys)), int(np.max(xs)), int(np.max(ys))]
                        bx1p, by1p = sam2_to_pixel(raw_bbox[0], raw_bbox[1])
                        bx2p, by2p = sam2_to_pixel(raw_bbox[2], raw_bbox[3])
                        bbox = [int(bx1p), int(by1p), int(bx2p), int(by2p)]
                        
                        # Filter drifted masks: if mask area suddenly explodes (>50x initial),
                        # the tracker likely drifted to the table/background
                        mask_area = len(xs)
                        if len(trajectory) > 0 and trajectory[0].get("_area", 0) > 0:
                            initial_area = trajectory[0]["_area"]
                            if mask_area > initial_area * 50:
                                confidence = 0.0  # Mark as lost — drifted
                        
                        if confidence > 0.1:  # Only include frames with meaningful confidence
                            entry = {
                                "frame": actual_frame_idx,
                                "x": float(cx),
                                "y": float(cy),
                                "confidence": round(confidence, 3),
                                "bbox": bbox,
                                "_area": mask_area,  # Internal, stripped before return
                            }
                            trajectory.append(entry)
                            continue
                
                # Lost frame
                trajectory.append({
                    "frame": actual_frame_idx,
                    "x": 0,
                    "y": 0,
                    "confidence": 0.0,
                    "bbox": None,
                    "_area": 0,
                })
                
                if local_frame_idx % 50 == 0:
                    logger.info(f"SAM2 tracking: {local_frame_idx}/{extracted}")
    
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)
    
    tracked = sum(1 for t in trajectory if t["confidence"] > 0)
    
    # Save trajectory
    import json
    trajectory_path = f"{output_dir}/trajectory.json"
    with open(trajectory_path, "w") as f:
        json.dump({
            "frames": trajectory,
            "video_info": {"width": width, "height": height, "fps": fps, "total_frames": total_video_frames}
        }, f)
    
    logger.info(f"SAM2 tracking complete: {tracked}/{extracted} tracked, {extracted - tracked} lost")
    
    # Strip internal _area field and filter to tracked frames only
    clean_trajectory = []
    for t in trajectory:
        if t["confidence"] > 0:
            clean_trajectory.append({
                "frame": t["frame"],
                "x": t["x"],
                "y": t["y"],
                "confidence": t["confidence"],
                "bbox": t["bbox"],
            })
    
    return {
        "status": "completed",
        "trajectory": clean_trajectory,
        "masks_dir": output_dir,
        "total_frames": extracted,
        "tracked_frames": tracked,
        "video_info": {"width": width, "height": height, "fps": fps},
    }


async def process_sam3d_segmentation(
    job_id: str,
    session_id: str,
    object_id: str,
    video_path: str,
    masks_dir: str,
    start_frame: int,
    end_frame: Optional[int]
):
    """Process SAM3D 3D point cloud segmentation."""
    import torch
    import numpy as np
    import cv2
    
    try:
        sam3d_components = registry.get("sam3d")
        if sam3d_components is None:
            job_tracker.fail_job(job_id, "SAM3D model not loaded")
            return
        
        midas = sam3d_components["midas"]
        transform = sam3d_components["transform"]
        device = sam3d_components["device"]
        
        # Create output directory
        output_dir = f"{config.results_dir}/{session_id}/sam3d/{object_id}"
        os.makedirs(output_dir, exist_ok=True)
        
        # Load video frames
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            job_tracker.fail_job(job_id, f"Cannot open video: {video_path}")
            return
        
        frames = []
        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx >= start_frame and (end_frame is None or frame_idx <= end_frame):
                frames.append((frame_idx, frame))
            frame_idx += 1
        cap.release()
        
        logger.info(f"Processing {len(frames)} frames for SAM3D")
        
        # Process each frame
        point_cloud_data = []
        
        with torch.no_grad():
            for frame_idx, frame_rgb in frames:
                # Load mask
                mask_path = f"{masks_dir}/mask_{frame_idx:05d}.png"
                if not os.path.exists(mask_path):
                    continue
                
                mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
                if mask is None:
                    continue
                
                # Estimate depth
                img = cv2.cvtColor(frame_rgb, cv2.COLOR_BGR2RGB)
                input_batch = transform(img).to(device)
                
                prediction = midas(input_batch)
                prediction = torch.nn.functional.interpolate(
                    prediction.unsqueeze(1),
                    size=img.shape[:2],
                    mode="bicubic",
                    align_corners=False
                ).squeeze()
                
                depth = prediction.cpu().numpy()
                
                # Project masked pixels to 3D
                mask_bool = mask > 127
                y_coords, x_coords = np.where(mask_bool)
                
                if len(x_coords) > 0:
                    # Sample points (limit for performance)
                    if len(x_coords) > 10000:
                        indices = np.random.choice(len(x_coords), 10000, replace=False)
                        x_coords = x_coords[indices]
                        y_coords = y_coords[indices]
                    
                    z_values = depth[y_coords, x_coords]
                    colors = frame_rgb[y_coords, x_coords]
                    
                    # Create 3D points (simple projection)
                    h, w = depth.shape
                    fx = fy = max(h, w)  # Approximate focal length
                    cx, cy = w / 2, h / 2
                    
                    x_3d = (x_coords - cx) * z_values / fx
                    y_3d = (y_coords - cy) * z_values / fy
                    z_3d = z_values
                    
                    for i in range(len(x_coords)):
                        point_cloud_data.append({
                            "frame": frame_idx,
                            "x": float(x_3d[i]),
                            "y": float(y_3d[i]),
                            "z": float(z_3d[i]),
                            "r": int(colors[i, 2]),
                            "g": int(colors[i, 1]),
                            "b": int(colors[i, 0])
                        })
        
        # Save point cloud as PLY
        ply_path = f"{output_dir}/point_cloud.ply"
        _save_point_cloud_ply(point_cloud_data, ply_path)
        
        # Save metadata
        import json
        meta_path = f"{output_dir}/segmentation.json"
        with open(meta_path, "w") as f:
            json.dump({
                "session_id": session_id,
                "object_id": object_id,
                "total_points": len(point_cloud_data),
                "frames_processed": len(frames),
                "point_cloud_path": ply_path
            }, f)
        
        job_tracker.complete_job(job_id, {
            "point_cloud_path": ply_path,
            "total_points": len(point_cloud_data),
            "frames_processed": len(frames)
        })
        
        logger.info(f"SAM3D complete: {len(point_cloud_data)} points from {len(frames)} frames")
    
    except Exception as e:
        logger.error(f"SAM3D processing failed: {e}")
        job_tracker.fail_job(job_id, str(e))


def _save_point_cloud_ply(points: List[Dict], path: str):
    """Save point cloud data as PLY file."""
    with open(path, "w") as f:
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {len(points)}\n")
        f.write("property float x\n")
        f.write("property float y\n")
        f.write("property float z\n")
        f.write("property uchar red\n")
        f.write("property uchar green\n")
        f.write("property uchar blue\n")
        f.write("end_header\n")
        
        for p in points:
            f.write(f"{p['x']:.6f} {p['y']:.6f} {p['z']:.6f} {p['r']} {p['g']} {p['b']}\n")


# ============================================================================
# FastAPI Application
# ============================================================================

start_time = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for model loading/cleanup."""
    # Startup: Load models
    logger.info("Starting ProVision Model Server...")
    
    for model_name in config.models_to_load:
        model_name = model_name.strip().lower()
        try:
            if model_name == "sam2":
                model, load_time = load_sam2_model(
                    config.sam2_path,
                    config.sam2_config,
                    config.sam2_dir
                )
                registry.set("sam2", model, load_time)
            
            elif model_name == "yolo":
                yolo_start = time.time()
                from ultralytics import YOLO
                import numpy as np
                # Detection model (ball detection)
                yolo = YOLO("yolo11n.pt")
                yolo(np.zeros((640, 640, 3), dtype=np.uint8), verbose=False)
                registry.set("yolo", yolo, time.time() - yolo_start)
                # Pose model (multi-person pose estimation)
                pose_start = time.time()
                yolo_pose = YOLO("yolo11n-pose.pt")
                yolo_pose(np.zeros((640, 640, 3), dtype=np.uint8), verbose=False)
                registry.set("yolo_pose", yolo_pose, time.time() - pose_start)
                logger.info(f"YOLO detect+pose loaded in {time.time() - yolo_start:.2f}s")
            
            elif model_name == "tracknet":
                model, load_time = load_tracknet_model(
                    config.tracknet_path,
                    config.tracknet_dir
                )
                registry.set("tracknet", model, load_time)
            
            elif model_name == "ttnet":
                model, load_time = load_ttnet_model(
                    config.ttnet_path,
                    config.ttnet_dir
                )
                registry.set("ttnet", model, load_time)
            
            elif model_name == "sam3d":
                model, load_time = load_sam3d_model(
                    config.sam3d_path,
                    config.sam3d_dir
                )
                registry.set("sam3d", model, load_time)
            
            else:
                logger.warning(f"Unknown model: {model_name}")
        
        except Exception as e:
            logger.error(f"Failed to load {model_name}: {e}")
    
    registry._initialized = True
    logger.info(f"Model server ready. Loaded: {registry.list_models()}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down model server...")
    registry._shutting_down = True


app = FastAPI(
    title="ProVision Model Server",
    description="GPU-accelerated SAM2 and SAM3D inference server",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# API Routes
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check server health and loaded models."""
    return HealthResponse(
        status="ok",
        uptime_seconds=time.time() - start_time,
        models=registry.get_status()["models"],
        device=registry.device
    )


@app.post("/sam2/init")
async def sam2_init(request: SAM2InitRequest):
    """Initialize SAM2 with a video."""
    if not registry.is_loaded("sam2"):
        raise HTTPException(status_code=503, detail="SAM2 model not loaded")
    
    return {"status": "ready", "session_id": request.session_id}


def _run_tracknet_pass(frame_list, model, device, postprocess_fn):
    """Run TrackNet inference on a sequence of frames (forward or backward).
    Returns (ball_track, conf_track, dists).
    
    Optimized: pre-resize all frames once, pre-convert to float32/GPU tensors.
    """
    import cv2
    import numpy as np
    import torch
    from scipy.spatial import distance
    
    TN_W, TN_H = 640, 360
    n = len(frame_list)
    ball_track = [(None, None)] * 2
    conf_track = [0.0, 0.0]
    dists = [-1] * 2
    
    # Pre-resize all frames once (avoids 3x redundant resize per iteration)
    resized = []
    for f in frame_list:
        r = cv2.resize(f, (TN_W, TN_H)).astype(np.float32) / 255.0
        resized.append(np.rollaxis(r, 2, 0))  # (3, H, W)
    
    # Pre-build all frame triplets for batched GPU inference
    # Batching amortizes CUDA kernel launch + PCIe transfer overhead
    triplets = []
    for num in range(2, n):
        imgs = np.concatenate((resized[num], resized[num-1], resized[num-2]), axis=0)
        triplets.append(imgs)

    batch_size = 8  # Conservative: ~300MB peak VRAM for (8, 9, 360, 640)
    with torch.no_grad():
        for batch_start in range(0, len(triplets), batch_size):
            batch = triplets[batch_start:batch_start + batch_size]
            inp = torch.from_numpy(np.stack(batch)).float().to(device)
            out = model(inp, testing=True)
            outputs = out.argmax(dim=1).detach().cpu().numpy()

            for j in range(len(batch)):
                x_pred, y_pred, conf_pred = postprocess_fn(outputs[j:j+1])
                ball_track.append((x_pred, y_pred))
                conf_track.append(conf_pred)
                if ball_track[-1][0] is not None and ball_track[-2][0] is not None:
                    dist = distance.euclidean(ball_track[-1], ball_track[-2])
                else:
                    dist = -1
                dists.append(dist)

    return ball_track, conf_track, dists


@app.post("/tracknet/track")
async def tracknet_track(request: SAM2TrackRequest):
    """Track ball through entire video using bidirectional TrackNet + YOLO recovery.
    
    Pipeline:
    1. Forward TrackNet pass (frame 2 → end)
    2. Backward TrackNet pass (end → frame 2), reversed back
    3. Merge: higher confidence wins, gaps filled from either direction
    4. Outlier removal + segment splitting + physics-aware bridging + interpolation
    5. YOLO recovery: fill remaining gaps with YOLO ball detection
    """
    import cv2
    import numpy as np
    import torch
    
    tracknet_model = registry.get("tracknet")
    if tracknet_model is None:
        raise HTTPException(status_code=503, detail="TrackNet model not loaded")
    
    device = registry.device
    
    cap = cv2.VideoCapture(request.video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open video: {request.video_path}")
    
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    frames = []
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
    cap.release()
    
    n = len(frames)
    logger.info(f"TrackNet bidirectional: {n} frames, {orig_w}x{orig_h} @ {fps:.1f}fps")
    
    sys.path.insert(0, config.tracknet_dir)
    from utils import postprocess, remove_outliers, split_track, interpolation, bridge_segments
    
    # === Pass 1: Forward ===
    fwd_track, fwd_conf, fwd_dists = _run_tracknet_pass(frames, tracknet_model, device, postprocess)
    fwd_det = sum(1 for b in fwd_track if b[0] is not None)
    logger.info(f"TrackNet forward: {fwd_det}/{n} detections")
    
    # === Pass 2: Backward (reverse frames, then reverse results) ===
    bwd_track, bwd_conf, bwd_dists = _run_tracknet_pass(frames[::-1], tracknet_model, device, postprocess)
    bwd_track.reverse()
    bwd_conf.reverse()
    bwd_det = sum(1 for b in bwd_track if b[0] is not None)
    logger.info(f"TrackNet backward: {bwd_det}/{n} detections")
    
    from scipy.spatial import distance

    # === Pre-merge: Physics-based motion validation ===
    # Reject detections that are physically impossible (teleports to wrong objects)
    # Ping pong ball max speed ~30-40 m/s, at 1920px width ~= 2m → ~30-60 px/frame at 30fps
    MAX_BALL_SPEED_PX_PER_FRAME = 80  # Conservative upper bound for 30fps

    def is_physically_plausible(new_pt, prev_pt, prev2_pt, confidence):
        """Check if detection is physically plausible given recent history."""
        if new_pt[0] is None or prev_pt[0] is None:
            return True  # No history to validate against

        # Distance from previous frame
        dist_from_prev = distance.euclidean(new_pt, prev_pt)

        # Reject obvious teleports (>80px in one frame at 30fps)
        if dist_from_prev > MAX_BALL_SPEED_PX_PER_FRAME:
            # Only accept if confidence is very high (0.8+) — might be a smash
            if confidence < 0.8:
                return False

        # If we have 2+ history points, check velocity consistency
        if prev2_pt[0] is not None:
            # Expected position based on constant velocity
            pred_x = prev_pt[0] + (prev_pt[0] - prev2_pt[0])
            pred_y = prev_pt[1] + (prev_pt[1] - prev2_pt[1])
            pred_pt = (pred_x, pred_y)

            # How far is detection from predicted position?
            pred_error = distance.euclidean(new_pt, pred_pt)

            # Reject if deviation is too large (ball changed direction impossibly)
            # Allow more deviation if confidence is high
            max_deviation = 60 if confidence > 0.7 else 40
            if pred_error > max_deviation:
                return False

        return True

    # Validate forward and backward tracks before merging
    validated_fwd = []
    validated_bwd = []
    for i in range(n):
        fwd_pt = fwd_track[i] if i < len(fwd_track) else (None, None)
        fc = fwd_conf[i] if i < len(fwd_conf) else 0.0
        prev_fwd = validated_fwd[i-1] if i > 0 and len(validated_fwd) > i-1 else (None, None)
        prev2_fwd = validated_fwd[i-2] if i > 1 and len(validated_fwd) > i-2 else (None, None)

        if fwd_pt[0] is not None and not is_physically_plausible(fwd_pt, prev_fwd, prev2_fwd, fc):
            validated_fwd.append((None, None))
        else:
            validated_fwd.append(fwd_pt)

    for i in range(n):
        bwd_pt = bwd_track[i] if i < len(bwd_track) else (None, None)
        bc = bwd_conf[i] if i < len(bwd_conf) else 0.0
        prev_bwd = validated_bwd[i-1] if i > 0 and len(validated_bwd) > i-1 else (None, None)
        prev2_bwd = validated_bwd[i-2] if i > 1 and len(validated_bwd) > i-2 else (None, None)

        if bwd_pt[0] is not None and not is_physically_plausible(bwd_pt, prev_bwd, prev2_bwd, bc):
            validated_bwd.append((None, None))
        else:
            validated_bwd.append(bwd_pt)

    rejected_fwd = sum(1 for i in range(n) if fwd_track[i][0] is not None and validated_fwd[i][0] is None)
    rejected_bwd = sum(1 for i in range(n) if bwd_track[i][0] is not None and validated_bwd[i][0] is None)
    logger.info(f"Motion validation: rejected {rejected_fwd} forward, {rejected_bwd} backward detections")

    # === Merge: higher confidence wins, fill gaps from either ===
    ball_track = [(None, None)] * n
    conf_track = [0.0] * n
    for i in range(n):
        fwd_pt = validated_fwd[i]  # Use validated tracks
        bwd_pt = validated_bwd[i]
        fc = fwd_conf[i] if i < len(fwd_conf) else 0.0
        bc = bwd_conf[i] if i < len(bwd_conf) else 0.0
        prev_pt = ball_track[i - 1] if i > 0 else (None, None)
        prev2_pt = ball_track[i - 2] if i > 1 else (None, None)
        pred_pt = (None, None)
        if prev_pt[0] is not None and prev2_pt[0] is not None:
            pred_pt = (
                prev_pt[0] + (prev_pt[0] - prev2_pt[0]),
                prev_pt[1] + (prev_pt[1] - prev2_pt[1]),
            )

        if fwd_pt[0] is not None and bwd_pt[0] is not None:
            if pred_pt[0] is not None:
                df = distance.euclidean(pred_pt, fwd_pt)
                db = distance.euclidean(pred_pt, bwd_pt)
                if abs(df - db) > 20:
                    if df <= db:
                        ball_track[i] = fwd_pt
                        conf_track[i] = fc
                    else:
                        ball_track[i] = bwd_pt
                        conf_track[i] = bc
                elif fc >= bc:
                    ball_track[i] = fwd_pt
                    conf_track[i] = fc
                else:
                    ball_track[i] = bwd_pt
                    conf_track[i] = bc
            elif prev_pt[0] is not None:
                df = distance.euclidean(prev_pt, fwd_pt)
                db = distance.euclidean(prev_pt, bwd_pt)
                if abs(df - db) > 25:
                    if df <= db:
                        ball_track[i] = fwd_pt
                        conf_track[i] = fc
                    else:
                        ball_track[i] = bwd_pt
                        conf_track[i] = bc
                elif fc >= bc:
                    ball_track[i] = fwd_pt
                    conf_track[i] = fc
                else:
                    ball_track[i] = bwd_pt
                    conf_track[i] = bc
            elif fc >= bc:
                ball_track[i] = fwd_pt
                conf_track[i] = fc
            else:
                ball_track[i] = bwd_pt
                conf_track[i] = bc
        elif fwd_pt[0] is not None:
            ball_track[i] = fwd_pt
            conf_track[i] = fc
        elif bwd_pt[0] is not None:
            ball_track[i] = bwd_pt
            conf_track[i] = bc
    
    merged_det = sum(1 for b in ball_track if b[0] is not None)
    logger.info(f"TrackNet merged: {merged_det}/{n} detections (fwd={fwd_det}, bwd={bwd_det})")
    
    # === Post-processing ===
    dists = [-1] * n
    for i in range(1, n):
        if ball_track[i][0] is not None and ball_track[i-1][0] is not None:
            dists[i] = distance.euclidean(ball_track[i], ball_track[i-1])
    
    # Outlier removal with tighter threshold for ping pong (reduce jitter from false detections)
    ball_track = remove_outliers(ball_track, dists, max_dist=100)
    
    # Second pass: confidence-based filtering (remove low-confidence detections that cause jitter)
    for i in range(n):
        if ball_track[i][0] is not None and conf_track[i] < 0.15:
            ball_track[i] = (None, None)
    
    # Third pass: teleport filter using local motion + confidence gating
    valid_dists = [
        distance.euclidean(ball_track[i], ball_track[i - 1])
        for i in range(1, n)
        if ball_track[i][0] is not None and ball_track[i - 1][0] is not None
    ]
    median_dist = float(np.median(valid_dists)) if valid_dists else 0.0
    fps_scale = max(1.0, 30.0 / max(fps, 1.0))
    base_jump = max(60.0, median_dist * 3.0) * fps_scale
    hard_jump = max(110.0, median_dist * 5.0) * fps_scale
    for i in range(1, n - 1):
        if ball_track[i][0] is None:
            continue
        prev_pt = ball_track[i - 1]
        next_pt = ball_track[i + 1]
        if prev_pt[0] is not None and next_pt[0] is not None:
            d_prev = distance.euclidean(ball_track[i], prev_pt)
            d_next = distance.euclidean(ball_track[i], next_pt)
            d_skip = distance.euclidean(prev_pt, next_pt)
            if d_prev > base_jump and d_next > base_jump and d_skip < base_jump * 1.2 and conf_track[i] < 0.45:
                ball_track[i] = (None, None)
                continue
        if prev_pt[0] is not None:
            d_prev = distance.euclidean(ball_track[i], prev_pt)
            if d_prev > hard_jump and conf_track[i] < 0.35:
                ball_track[i] = (None, None)
                continue
        if i >= 2 and prev_pt[0] is not None:
            prev2_pt = ball_track[i - 2]
            if prev2_pt[0] is not None:
                pred = (
                    prev_pt[0] + (prev_pt[0] - prev2_pt[0]),
                    prev_pt[1] + (prev_pt[1] - prev2_pt[1]),
                )
                d_pred = distance.euclidean(ball_track[i], pred)
                if d_pred > hard_jump and conf_track[i] < 0.5:
                    ball_track[i] = (None, None)

    # Fourth pass: median window spike filter (mid-flight teleports)
    window = 2
    for i in range(window, n - window):
        if ball_track[i][0] is None:
            continue
        neighbors = []
        for j in range(i - window, i + window + 1):
            if j == i:
                continue
            if ball_track[j][0] is not None:
                neighbors.append(ball_track[j])
        if len(neighbors) >= 3:
            mx = float(np.median([p[0] for p in neighbors]))
            my = float(np.median([p[1] for p in neighbors]))
            d_med = distance.euclidean(ball_track[i], (mx, my))
            if d_med > base_jump * 0.8 and conf_track[i] < 0.55:
                ball_track[i] = (None, None)
    
    subtracks = split_track(ball_track)
    
    # Bridge segments across hit events before interpolation
    ball_track = bridge_segments(ball_track, subtracks)
    
    # Re-split after bridging (some gaps may now be filled)
    subtracks = split_track(ball_track)
    for r in subtracks:
        ball_subtrack = ball_track[r[0]:r[1]]
        ball_subtrack = interpolation(ball_subtrack)
        ball_track[r[0]:r[1]] = ball_subtrack

    # === YOLO Recovery: fill gaps BEFORE smoothing ===
    # Placed before One Euro Filter so recovered points get smoothed too.
    # Inserting raw data after low-pass filtering creates high-frequency
    # discontinuities at gap boundaries (Gibbs phenomenon).
    yolo_model = registry.get("yolo")
    yolo_recovered = 0
    if yolo_model is not None:
        gap_frames = [i for i in range(n) if ball_track[i][0] is None]
        for gi in gap_frames[::2]:
            try:
                results = yolo_model(frames[gi], verbose=False, conf=0.15, imgsz=640)
                for r in results:
                    for box in r.boxes:
                        if int(box.cls[0]) == 32:  # sports ball
                            bx1, by1, bx2, by2 = box.xyxy[0].tolist()
                            cx = ((bx1 + bx2) / 2) * (1280.0 / orig_w)
                            cy = ((by1 + by2) / 2) * (720.0 / orig_h)
                            # Spatial validation: reject detections far from existing track
                            # Prevents latching onto a different ball on screen
                            nearest_dist = float('inf')
                            for offset in [-3, -2, -1, 1, 2, 3]:
                                ni = gi + offset
                                if 0 <= ni < n and ball_track[ni][0] is not None:
                                    d = distance.euclidean((cx, cy), ball_track[ni])
                                    nearest_dist = min(nearest_dist, d)
                            if nearest_dist < 120:  # ~1.5x max ball speed per frame
                                ball_track[gi] = (cx, cy)
                                conf_track[gi] = float(box.conf[0]) * 0.8
                                yolo_recovered += 1
                                if gi + 1 < n and ball_track[gi + 1][0] is None:
                                    ball_track[gi + 1] = (cx, cy)
                                    conf_track[gi + 1] = float(box.conf[0]) * 0.7
                            break
                    break
            except Exception:
                pass
    if yolo_recovered:
        logger.info(f"YOLO recovered {yolo_recovered} gap frames")

    # === One Euro Filter Smoothing (adaptive + responsive) ===
    # Replaces EMA with One Euro Filter for better jitter reduction while preserving fast motion
    class LowPassFilter:
        def __init__(self, alpha: float):
            self.alpha = alpha
            self.s = None

        def __call__(self, value: float) -> float:
            if self.s is None:
                self.s = value
            else:
                self.s = self.alpha * value + (1 - self.alpha) * self.s
            return self.s

        def reset(self):
            self.s = None

    class OneEuroFilter:
        def __init__(self, min_cutoff: float = 1.0, beta: float = 0.0, d_cutoff: float = 1.0):
            self.min_cutoff = min_cutoff
            self.beta = beta
            self.d_cutoff = d_cutoff
            self.x_filter = LowPassFilter(self._alpha(min_cutoff))
            self.dx_filter = LowPassFilter(self._alpha(d_cutoff))
            self.last_value = None

        def _alpha(self, cutoff: float) -> float:
            te = 1.0 / max(fps, 1.0)  # Actual video FPS
            tau = 1.0 / (2 * 3.14159 * cutoff)
            return 1.0 / (1.0 + tau / te)

        def __call__(self, value: float) -> float:
            if self.last_value is None:
                self.last_value = value
                return value

            # Compute derivative (velocity)
            dx = (value - self.last_value) * fps
            edx = self.dx_filter(dx)

            # Adaptive cutoff: higher velocity = less smoothing (more responsive)
            cutoff = self.min_cutoff + self.beta * abs(edx)
            self.x_filter.alpha = self._alpha(cutoff)

            self.last_value = value
            return self.x_filter(value)

        def reset(self):
            self.x_filter.reset()
            self.dx_filter.reset()
            self.last_value = None

    # Create filters for x and y coordinates
    # min_cutoff: Lower = more smoothing (0.5-1.5 for ball)
    # beta: Higher = more responsive to fast motion (0.5-1.0 for ball)
    x_filter = OneEuroFilter(min_cutoff=0.8, beta=0.7)
    y_filter = OneEuroFilter(min_cutoff=0.8, beta=0.7)

    # Apply filter with improved gap handling:
    # - Reset filter after long gaps (Casiez 2012: assumes continuous input)
    # - Quadratic (constant-acceleration) gap prediction models projectile motion
    # - Predict from anchor point (last real detection), not from previous predictions
    # - Cap prediction at 8 frames (~267ms) to prevent divergence
    # - Clamp to video bounds (TrackNet space: 1280x720)
    MAX_GAP_PREDICTION = 8
    FILTER_RESET_GAP = 5

    smoothed_track = []
    gap_count = 0
    anchor_idx = -1  # Index of last real (non-predicted) smoothed point

    for i in range(n):
        if ball_track[i][0] is not None:
            if gap_count > FILTER_RESET_GAP:
                x_filter.reset()
                y_filter.reset()
            gap_count = 0
            smoothed_x = x_filter(ball_track[i][0])
            smoothed_y = y_filter(ball_track[i][1])
            smoothed_track.append((smoothed_x, smoothed_y))
            anchor_idx = len(smoothed_track) - 1
        else:
            gap_count += 1
            if gap_count <= MAX_GAP_PREDICTION and anchor_idx >= 2:
                # Quadratic prediction: p(t) = p0 + v0*t + 0.5*a*t^2
                # Captures gravity/spin deceleration in free flight
                a0 = smoothed_track[anchor_idx]
                a1 = smoothed_track[anchor_idx - 1]
                a2 = smoothed_track[anchor_idx - 2]
                vx = a0[0] - a1[0]
                vy = a0[1] - a1[1]
                ax = a0[0] - 2 * a1[0] + a2[0]  # 2nd derivative (acceleration)
                ay = a0[1] - 2 * a1[1] + a2[1]
                t = float(gap_count)
                predicted_x = a0[0] + vx * t + 0.5 * ax * t * t
                predicted_y = a0[1] + vy * t + 0.5 * ay * t * t
                predicted_x = max(0.0, min(1280.0, predicted_x))
                predicted_y = max(0.0, min(720.0, predicted_y))
                smoothed_track.append((predicted_x, predicted_y))
            elif gap_count <= MAX_GAP_PREDICTION and anchor_idx >= 1:
                # Linear fallback with only 2 history points
                a0 = smoothed_track[anchor_idx]
                a1 = smoothed_track[anchor_idx - 1]
                vx = a0[0] - a1[0]
                vy = a0[1] - a1[1]
                t = float(gap_count)
                predicted_x = max(0.0, min(1280.0, a0[0] + vx * t))
                predicted_y = max(0.0, min(720.0, a0[1] + vy * t))
                smoothed_track.append((predicted_x, predicted_y))
            else:
                smoothed_track.append((None, None))

    ball_track = smoothed_track
    
    # === Convert to output trajectory ===
    MIN_CONFIDENCE = 0.2  # Don't output detections below this threshold (reduces jitter)
    
    trajectory = []
    for frame_idx, (x, y) in enumerate(ball_track):
        if x is not None and y is not None:
            real_conf = conf_track[frame_idx] if frame_idx < len(conf_track) else 0.5
            
            # Skip low-confidence detections (likely false positives causing jitter)
            if real_conf < MIN_CONFIDENCE:
                continue
            
            px = float(x) * (orig_w / 1280.0)
            py = float(y) * (orig_h / 720.0)
            ball_half = 10 * (orig_w / 1280.0)
            bbox = [
                max(0, int(px - ball_half)), max(0, int(py - ball_half)),
                min(orig_w, int(px + ball_half)), min(orig_h, int(py + ball_half)),
            ]
            
            trajectory.append({
                "frame": frame_idx,
                "x": round(px, 1),
                "y": round(py, 1),
                "confidence": round(real_conf, 3),
                "bbox": bbox,
            })
    
    detected = len(trajectory)
    logger.info(f"TrackNet complete: {detected}/{n} frames tracked (bidir+bridge+yolo)")
    
    return {
        "status": "completed",
        "trajectory": trajectory,
        "total_frames": n,
        "tracked_frames": detected,
        "video_info": {"width": orig_w, "height": orig_h, "fps": fps},
    }


class TTNetTrackRequest(BaseModel):
    session_id: str
    video_path: str
    frame: int = 0


@app.post("/ttnet/track")
async def ttnet_track(request: TTNetTrackRequest):
    """Track ball through entire video using TTNet (table tennis specific).
    
    TTNet uses 9 consecutive frames for temporal context and a two-stage
    (global + local refinement) architecture trained on table tennis data.
    Much better than TrackNet for ping pong ball detection.
    
    Output format matches TrackNet for drop-in compatibility.
    """
    import cv2
    import numpy as np
    import torch
    
    ttnet_model = registry.get("ttnet")
    if ttnet_model is None:
        raise HTTPException(status_code=503, detail="TTNet model not loaded. Start server with --models ttnet")
    
    device = registry.device
    
    cap = cv2.VideoCapture(request.video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open video: {request.video_path}")
    
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    # Read all frames
    frames = []
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
    cap.release()
    
    n = len(frames)
    logger.info(f"TTNet tracking: {n} frames, {orig_w}x{orig_h} @ {fps:.1f}fps")
    
    w_resize, h_resize = config.ttnet_input_size  # (320, 128)
    num_seq = config.ttnet_num_frames  # 9
    
    # Resize all frames to TTNet input size
    resized_frames = []
    for frame in frames:
        resized = cv2.resize(frame, (w_resize, h_resize))
        resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        resized_frames.append(resized)
    
    trajectory = []
    
    with torch.no_grad():
        for i in range(num_seq - 1, n):
            # Build input: 9 consecutive frames concatenated along channel dim
            # Shape: (1, 27, 128, 320)
            frame_batch = []
            for j in range(num_seq):
                idx = i - (num_seq - 1) + j
                frame_batch.append(resized_frames[idx])
            
            # Stack frames: (9, H, W, 3) -> (1, 27, H, W)
            inp = np.stack(frame_batch, axis=0)  # (9, 128, 320, 3)
            inp = inp.transpose(0, 3, 1, 2)  # (9, 3, 128, 320)
            inp = inp.reshape(1, num_seq * 3, h_resize, w_resize)  # (1, 27, 128, 320)
            inp = torch.from_numpy(inp).float().to(device)
            
            # Dummy ball position (not needed for inference)
            dummy_pos = torch.tensor([[-1.0, -1.0]]).to(device)
            
            pred_global, pred_local, pred_events, pred_seg, _ = ttnet_model(inp, dummy_pos)
            
            # Extract ball position from prediction
            # pred_global shape: (1, 448) -> first 320 values = x distribution, next 128 = y distribution
            pred = pred_local if pred_local is not None else pred_global
            pred_np = pred[0].cpu().numpy()
            
            x_pred = pred_np[:w_resize]
            y_pred = pred_np[w_resize:]
            
            x_conf = float(np.max(x_pred))
            y_conf = float(np.max(y_pred))
            conf = min(x_conf, y_conf)
            
            if conf > 0.05:  # Detection threshold
                x_pos = float(np.argmax(x_pred))
                y_pos = float(np.argmax(y_pred))
                
                # Scale from TTNet coords to original video coords
                px = x_pos * (orig_w / w_resize)
                py = y_pos * (orig_h / h_resize)
                
                ball_half = 10 * (orig_w / 1280.0)
                bbox = [
                    max(0, int(px - ball_half)), max(0, int(py - ball_half)),
                    min(orig_w, int(px + ball_half)), min(orig_h, int(py + ball_half)),
                ]
                
                trajectory.append({
                    "frame": i,
                    "x": round(px, 1),
                    "y": round(py, 1),
                    "confidence": round(conf, 3),
                    "bbox": bbox,
                })
            
            if i % 50 == 0:
                logger.info(f"TTNet progress: {i}/{n}")
    
    detected = len(trajectory)
    logger.info(f"TTNet complete: {detected}/{n} frames tracked")
    
    return {
        "status": "completed",
        "trajectory": trajectory,
        "total_frames": n,
        "tracked_frames": detected,
        "video_info": {"width": orig_w, "height": orig_h, "fps": fps},
    }


@app.post("/yolo/detect")
async def yolo_detect(request: SAM2TrackRequest):
    """Detect sports balls in a video frame using YOLOv11n.
    
    Best practices applied:
    - Model loaded once at startup via registry (not per-request)
    - Uses imgsz=640 (YOLO default, best speed/accuracy for nano)
    - Filters COCO class 32 ("sports ball") first, then falls back to small-object heuristic
    - Returns base64 preview with annotated detections
    """
    import cv2
    import numpy as np
    import base64
    
    yolo_model = registry.get("yolo")
    if yolo_model is None:
        raise HTTPException(status_code=503, detail="YOLO model not loaded. Restart server with --models sam2,yolo")
    
    cap = cv2.VideoCapture(request.video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open video: {request.video_path}")
    
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, request.frame))
    ret, frame_img = cap.read()
    cap.release()
    
    if not ret or frame_img is None:
        raise HTTPException(status_code=400, detail="Could not read frame")
    
    # Run YOLO detection — model is already on GPU, reused across requests
    # conf=0.15 (lower threshold catches faint/blurry ping pong balls, filtering below)
    # imgsz=640 is the default optimal resolution for yolo11n
    results = yolo_model(frame_img, verbose=False, conf=0.15, imgsz=640)
    
    detections = []
    preview = frame_img.copy()
    
    # Pass 1: Direct "sports ball" detections (COCO class 32)
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            if cls_id == 32:  # sports ball
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                detections.append({
                    "bbox": [x1, y1, x2, y2],
                    "confidence": round(conf, 3),
                    "class_name": "sports ball",
                    "center": [(x1 + x2) // 2, (y1 + y2) // 2],
                    "size": [(x2 - x1), (y2 - y1)],
                })
                cv2.rectangle(preview, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(preview, f"ball {conf:.0%}", (x1, max(y1 - 5, 10)),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
    
    # Pass 2: Fallback — if no sports ball found, look for small, roughly square objects
    # Ping pong balls are often too small/blurry for COCO's sports_ball class
    if not detections:
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                # Skip person (0), known large objects
                if cls_id in (0, 56, 57, 60, 62, 63):  # person, chair, couch, table, tv, laptop
                    continue
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                w, h = x2 - x1, y2 - y1
                # Small objects (< 80px max dim) with roughly circular aspect ratio
                aspect = max(w, h) / max(min(w, h), 1)
                if max(w, h) < 80 and min(w, h) > 3 and aspect < 3.0:
                    conf = float(box.conf[0])
                    cls_name = yolo_model.names[cls_id]
                    detections.append({
                        "bbox": [x1, y1, x2, y2],
                        "confidence": round(conf, 3),
                        "class_name": f"{cls_name} (candidate)",
                        "center": [(x1 + x2) // 2, (y1 + y2) // 2],
                        "size": [w, h],
                    })
                    cv2.rectangle(preview, (x1, y1), (x2, y2), (0, 200, 255), 2)
                    cv2.putText(preview, f"? {conf:.0%}", (x1, max(y1 - 5, 10)),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 255), 1)
    
    # Sort by confidence descending
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    
    _, buffer = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 85])
    preview_b64 = base64.b64encode(buffer).decode('utf-8')
    
    logger.info(f"YOLO detected {len(detections)} candidate(s) in frame {request.frame}")
    
    return {
        "detections": detections,
        "frame": request.frame,
        "width": width,
        "height": height,
        "preview_image": f"data:image/jpeg;base64,{preview_b64}",
    }


COCO_KEYPOINT_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]

SKELETON_CONNECTIONS = [
    (0, 1), (0, 2), (1, 3), (2, 4),  # face
    (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),  # arms
    (5, 11), (6, 12), (11, 12),  # torso
    (11, 13), (13, 15), (12, 14), (14, 16),  # legs
]


@app.post("/yolo/pose")
async def yolo_pose(request: SAM2TrackRequest):
    """Detect all persons with bounding boxes and 17 COCO keypoints using YOLO11n-pose."""
    import cv2
    import numpy as np
    import base64

    pose_model = registry.get("yolo_pose")
    if pose_model is None:
        raise HTTPException(status_code=503, detail="YOLO-pose model not loaded")

    cap = cv2.VideoCapture(request.video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open video: {request.video_path}")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, request.frame))
    ret, frame_img = cap.read()
    cap.release()

    if not ret or frame_img is None:
        raise HTTPException(status_code=400, detail="Could not read frame")

    results = pose_model(frame_img, verbose=False, conf=0.3)
    preview = frame_img.copy()
    persons = []
    colors = [(155, 123, 91), (91, 155, 123), (123, 91, 155), (200, 180, 100)]

    for idx, r in enumerate(results):
        if r.boxes is None or r.keypoints is None:
            continue
        for pid, (box, kps) in enumerate(zip(r.boxes, r.keypoints)):
            conf = float(box.conf[0])
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
            color = colors[pid % len(colors)]

            keypoints_list = []
            kp_data = kps.data[0].cpu().numpy()  # (17, 3) — x, y, conf
            for ki in range(min(17, len(kp_data))):
                kx, ky, kc = float(kp_data[ki][0]), float(kp_data[ki][1]), float(kp_data[ki][2])
                keypoints_list.append({
                    "name": COCO_KEYPOINT_NAMES[ki] if ki < len(COCO_KEYPOINT_NAMES) else f"kp_{ki}",
                    "x": round(kx, 1), "y": round(ky, 1), "conf": round(kc, 3),
                })
                # Draw keypoint on preview
                if kc > 0.3:
                    cv2.circle(preview, (int(kx), int(ky)), 3, color, -1)

            # Draw skeleton connections
            for (a, b) in SKELETON_CONNECTIONS:
                if a < len(kp_data) and b < len(kp_data):
                    if kp_data[a][2] > 0.3 and kp_data[b][2] > 0.3:
                        pt1 = (int(kp_data[a][0]), int(kp_data[a][1]))
                        pt2 = (int(kp_data[b][0]), int(kp_data[b][1]))
                        cv2.line(preview, pt1, pt2, color, 2)

            # Draw bbox
            cv2.rectangle(preview, (x1, y1), (x2, y2), color, 2)
            cv2.putText(preview, f"P{pid+1} {conf:.0%}", (x1, max(y1 - 5, 10)),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

            persons.append({
                "id": pid + 1,
                "bbox": [x1, y1, x2, y2],
                "confidence": round(conf, 3),
                "keypoints": keypoints_list,
            })

    _, buffer = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 85])
    preview_b64 = base64.b64encode(buffer).decode('utf-8')

    logger.info(f"YOLO-pose detected {len(persons)} person(s) in frame {request.frame}")

    return {
        "persons": persons,
        "frame": request.frame,
        "width": width,
        "height": height,
        "preview_image": f"data:image/jpeg;base64,{preview_b64}",
    }


@app.post("/sam2/preview")
async def sam2_preview(request: SAM2TrackRequest):
    """Preview segmentation at a click point on a single frame (before full tracking).
    Returns bbox, center, area, and confidence for the user to confirm."""
    import torch
    import numpy as np
    import cv2
    import tempfile
    import shutil
    import base64
    
    predictor = registry.get("sam2")
    if predictor is None:
        raise HTTPException(status_code=503, detail="SAM2 model not loaded")
    
    # Extract just a few frames around the click frame
    cap = cv2.VideoCapture(request.video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open video: {request.video_path}")
    
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # Extract 3 frames for SAM2 context (click frame + neighbors)
    frames_dir = tempfile.mkdtemp(prefix="sam2_preview_")
    start = max(0, request.frame)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    
    click_frame_img = None
    for i in range(min(5, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) - start)):
        ret, frame_img = cap.read()
        if not ret:
            break
        if i == 0:
            click_frame_img = frame_img.copy()
        cv2.imwrite(os.path.join(frames_dir, f"{i:05d}.jpeg"), frame_img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    cap.release()
    
    if click_frame_img is None:
        shutil.rmtree(frames_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Could not read frame")
    
    try:
        with torch.inference_mode():
            inference_state = predictor.init_state(video_path=frames_dir)
            
            x, y = request.init_point["x"], request.init_point["y"]
            
            # Same aspect-ratio-aware coord transform as tracking
            longest = max(width, height)
            sx, sy = x * width / longest, y * height / longest
            box_half = 25 * min(width, height) / longest
            box = np.array([
                max(0, sx - box_half), max(0, sy - box_half),
                min(width * width / longest, sx + box_half),
                min(height * height / longest, sy + box_half),
            ], dtype=np.float32)
            neg_y = min(sy + box_half * 3, height * height / longest - 1)
            points = np.array([[sx, sy], [sx, neg_y]], dtype=np.float32)
            labels = np.array([1, 0], dtype=np.int32)
            
            predictor.reset_state(inference_state)
            _, out_obj_ids, out_mask_logits = predictor.add_new_points_or_box(
                inference_state=inference_state,
                frame_idx=0,
                obj_id=1,
                points=points,
                labels=labels,
                box=box,
                normalize_coords=True,
            )
            
            mask = (out_mask_logits[0] > 0.0).cpu().numpy()
            if mask.ndim == 3:
                mask = mask.squeeze()
            
            # Scale mask coords back to pixel coords for preview overlay
            def sam2_to_pixel_preview(sx, sy):
                return sx * longest / width, sy * longest / height
            
            result = {"success": False, "bbox": None, "center": None, "area_pixels": 0}
            
            if mask.any():
                ys, xs = np.where(mask)
                # Convert SAM2 internal coords to pixel coords
                raw_bbox = [int(np.min(xs)), int(np.min(ys)), int(np.max(xs)), int(np.max(ys))]
                bx1p, by1p = sam2_to_pixel_preview(raw_bbox[0], raw_bbox[1])
                bx2p, by2p = sam2_to_pixel_preview(raw_bbox[2], raw_bbox[3])
                bbox = [int(bx1p), int(by1p), int(bx2p), int(by2p)]
                cx_raw, cy_raw = float(np.mean(xs)), float(np.mean(ys))
                cx, cy = sam2_to_pixel_preview(cx_raw, cy_raw)
                area = int(mask.sum())
                
                # Generate preview image with green mask overlay
                overlay = click_frame_img.copy()
                overlay[mask > 0] = [0, 255, 0]
                preview = cv2.addWeighted(overlay, 0.4, click_frame_img, 0.6, 0)
                cv2.rectangle(preview, (bbox[0], bbox[1]), (bbox[2], bbox[3]), (0, 255, 0), 2)
                cv2.circle(preview, (int(cx), int(cy)), 4, (255, 255, 255), -1)
                
                _, buffer = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 85])
                preview_b64 = base64.b64encode(buffer).decode('utf-8')
                
                result = {
                    "success": True,
                    "bbox": bbox,
                    "center": [cx, cy],
                    "area_pixels": area,
                    "width": width,
                    "height": height,
                    "preview_image": f"data:image/jpeg;base64,{preview_b64}",
                }
            
            predictor.reset_state(inference_state)
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)
    
    return result


@app.post("/sam2/track", response_model=SAM2TrackResponse)
async def sam2_track(request: SAM2TrackRequest):
    """Track object in video using SAM2."""
    try:
        result = await process_sam2_tracking(
            session_id=request.session_id,
            video_path=request.video_path,
            init_point=request.init_point,
            frame=request.frame,
            detection_box=request.detection_box,
        )
        
        return SAM2TrackResponse(
            session_id=request.session_id,
            status="completed",
            trajectory=result.get("trajectory"),
            masks_dir=result.get("masks_dir")
        )
    
    except Exception as e:
        logger.error(f"SAM2 tracking error: {e}")
        return SAM2TrackResponse(
            session_id=request.session_id,
            status="failed",
            error=str(e)
        )


@app.post("/sam3d/segment", response_model=SAM3DSegmentResponse)
async def sam3d_segment(request: SAM3DSegmentRequest, background_tasks: BackgroundTasks):
    """Start SAM3D 3D segmentation job."""
    if not registry.is_loaded("sam3d"):
        raise HTTPException(status_code=503, detail="SAM3D model not loaded")
    
    # Create job
    job_id = job_tracker.create_job(
        "sam3d",
        request.session_id,
        object_id=request.object_id
    )
    
    # Run in background
    background_tasks.add_task(
        process_sam3d_segmentation,
        job_id=job_id,
        session_id=request.session_id,
        object_id=request.object_id,
        video_path=request.video_path,
        masks_dir=request.masks_dir,
        start_frame=request.start_frame,
        end_frame=request.end_frame
    )
    
    return SAM3DSegmentResponse(
        session_id=request.session_id,
        object_id=request.object_id,
        status="processing",
        job_id=job_id
    )


@app.get("/sam3d/status/{job_id}")
async def sam3d_status(job_id: str):
    """Check SAM3D job status."""
    job = job_tracker.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="ProVision Model Server")
    parser.add_argument("--port", type=int, default=config.port, help="Server port")
    parser.add_argument("--host", type=str, default=config.host, help="Server host")
    parser.add_argument("--models", type=str, default="sam2", help="Models to load (comma-separated)")
    
    args = parser.parse_args()
    
    # Update config
    config.port = args.port
    config.models_to_load = args.models.split(",")
    
    logger.info(f"Starting server on {args.host}:{args.port}")
    logger.info(f"Models to load: {config.models_to_load}")
    
    uvicorn.run(app, host=args.host, port=args.port)
