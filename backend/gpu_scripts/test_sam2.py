import os, time, json, cv2, numpy as np, torch
from sam2.build_sam import build_sam2_video_predictor

CHECKPOINT = "/workspace/checkpoints/sam2.1_hiera_tiny.pt"
CONFIG = "configs/sam2.1/sam2.1_hiera_t.yaml"
VIDEOS = {
    "Video.mov": "/workspace/provision/data/videos/Video.mov",
    "pigpong.mov": "/workspace/provision/data/videos/pigpong.mov",
}

def extract_frames(video_path, output_dir, max_frames=150, resize_w=960):
    os.makedirs(output_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    idx = 0
    while cap.isOpened() and idx < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        h, w = frame.shape[:2]
        if w > resize_w:
            scale = resize_w / w
            frame = cv2.resize(frame, (resize_w, int(h * scale)))
        cv2.imwrite(os.path.join(output_dir, f"{idx:05d}.jpg"), frame)
        idx += 1
    cap.release()
    return idx

def run_ball_tracking(predictor, frames_dir, num_frames, click_x, click_y, click_frame=0):
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16):
        state = predictor.init_state(video_path=frames_dir)
        points = np.array([[click_x, click_y]], dtype=np.float32)
        labels = np.array([1], np.int32)
        _, out_obj_ids, out_mask_logits = predictor.add_new_points_or_box(
            inference_state=state,
            frame_idx=click_frame,
            obj_id=1,
            points=points,
            labels=labels,
        )
        trajectory = []
        t0 = time.time()
        for frame_idx, obj_ids, masks in predictor.propagate_in_video(state):
            mask = (masks[0] > 0).cpu().numpy().squeeze()
            if mask.any():
                ys, xs = np.where(mask)
                cx, cy = float(xs.mean()), float(ys.mean())
                area = int(mask.sum())
                trajectory.append({"frame": frame_idx, "x": cx, "y": cy, "area": area})
        propagate_time = time.time() - t0
        predictor.reset_state(state)
    return trajectory, propagate_time

def run_person_tracking(predictor, frames_dir, num_frames, click_x, click_y, click_frame=0):
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16):
        state = predictor.init_state(video_path=frames_dir)
        points = np.array([[click_x, click_y]], dtype=np.float32)
        labels = np.array([1], np.int32)
        predictor.add_new_points_or_box(
            inference_state=state,
            frame_idx=click_frame,
            obj_id=2,
            points=points,
            labels=labels,
        )
        masks_per_frame = {}
        t0 = time.time()
        for frame_idx, obj_ids, masks in predictor.propagate_in_video(state):
            mask = (masks[0] > 0).cpu().numpy().squeeze()
            if mask.any():
                area = int(mask.sum())
                masks_per_frame[frame_idx] = area
        propagate_time = time.time() - t0
        predictor.reset_state(state)
    return masks_per_frame, propagate_time

def generate_highlighted_video(video_path, trajectory, output_path, resize_w=960):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    first = True
    out = None
    traj_map = {t["frame"]: t for t in trajectory}
    idx = 0
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        h, w = frame.shape[:2]
        if w > resize_w:
            scale = resize_w / w
            frame = cv2.resize(frame, (resize_w, int(h * scale)))
        if first:
            fh, fw = frame.shape[:2]
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            out = cv2.VideoWriter(output_path, fourcc, fps, (fw, fh))
            first = False
        if idx in traj_map:
            cx = int(traj_map[idx]["x"])
            cy = int(traj_map[idx]["y"])
            cv2.circle(frame, (cx, cy), 20, (0, 255, 0), 3)
            cv2.circle(frame, (cx, cy), 8, (0, 255, 0), -1)
        out.write(frame)
        idx += 1
    cap.release()
    if out:
        out.release()
    return idx

print("Loading SAM2 model...")
t_load = time.time()
predictor = build_sam2_video_predictor(CONFIG, CHECKPOINT, device="cuda")
load_time = time.time() - t_load
print("Model loaded in {:.2f}s".format(load_time))

results = {}

for name, path in VIDEOS.items():
    print("\n" + "=" * 50)
    print("Processing: " + name)
    frames_dir = "/workspace/provision/data/frames_" + name.replace(".mov", "")

    t0 = time.time()
    num_frames = extract_frames(path, frames_dir)
    extract_time = time.time() - t0
    print("Extracted {} frames in {:.2f}s".format(num_frames, extract_time))

    first_frame = cv2.imread(os.path.join(frames_dir, "00000.jpg"))
    h, w = first_frame.shape[:2]
    ball_x, ball_y = w * 0.5, h * 0.4
    print("Frame size: {}x{}".format(w, h))
    print("Ball click: ({:.0f}, {:.0f})".format(ball_x, ball_y))

    print("Running ball tracking...")
    t_total = time.time()
    trajectory, prop_time = run_ball_tracking(predictor, frames_dir, num_frames, ball_x, ball_y)
    total_time = time.time() - t_total
    print("Ball tracking: {} frames detected in {:.2f}s (propagation: {:.2f}s)".format(
        len(trajectory), total_time, prop_time))
    print("FPS: {:.1f}".format(num_frames / total_time))

    # Generate highlighted video
    out_video = "/workspace/provision/data/results/" + name.replace(".mov", "_tracked.mp4")
    print("Generating highlighted video...")
    generate_highlighted_video(path, trajectory, out_video)
    print("Saved: " + out_video)

    # Person tracking
    person_x, person_y = w * 0.25, h * 0.5
    print("\nPerson click: ({:.0f}, {:.0f})".format(person_x, person_y))
    print("Running person tracking...")
    person_masks, person_time = run_person_tracking(predictor, frames_dir, num_frames, person_x, person_y)
    print("Person tracking: {} frames with mask in {:.2f}s".format(len(person_masks), person_time))
    avg_area = 0
    if person_masks:
        avg_area = sum(person_masks.values()) / len(person_masks)
        print("Average person mask area: {:.0f} pixels".format(avg_area))

    results[name] = {
        "frames": num_frames,
        "frame_size": "{}x{}".format(w, h),
        "extract_time": round(extract_time, 2),
        "ball_trajectory_frames": len(trajectory),
        "ball_tracking_time": round(total_time, 2),
        "ball_propagation_time": round(prop_time, 2),
        "ball_fps": round(num_frames / total_time, 1),
        "person_mask_frames": len(person_masks),
        "person_tracking_time": round(person_time, 2),
        "person_avg_mask_area": round(avg_area),
        "trajectory_sample": trajectory[:5] if trajectory else [],
    }

print("\n" + "=" * 50)
print("RESULTS SUMMARY:")
print(json.dumps(results, indent=2))

with open("/workspace/provision/data/results/sam2_test_results.json", "w") as f:
    json.dump(results, f, indent=2)
print("\nResults saved.")
