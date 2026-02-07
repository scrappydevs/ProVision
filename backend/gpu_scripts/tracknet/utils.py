import numpy as np
import cv2
from itertools import groupby
from scipy.spatial import distance


def postprocess(feature_map, scale=2):
    """Convert TrackNet heatmap output to (x, y, confidence) ball coordinates.
    
    Tuned for ping pong transfer learning:
    - Threshold lowered from 127 to 80 (catches weaker detections from tennis pretrained model)
    - param2 lowered from 2 to 1 (more sensitive circle detection)
    - maxRadius increased from 7 to 12 (ping pong ball can appear larger at close range)
    - Prefer the candidate with the strongest heatmap peak (reduces teleports)
    - Fallback to contour centroid for ellipsoid-like blobs
    """
    raw_map = feature_map.reshape((360, 640))
    peak = float(np.max(raw_map))
    scaled = (raw_map * 255).astype(np.uint8)
    _, heatmap = cv2.threshold(scaled, 80, 255, cv2.THRESH_BINARY)
    circles = cv2.HoughCircles(
        heatmap, cv2.HOUGH_GRADIENT, dp=1, minDist=1,
        param1=50, param2=1, minRadius=2, maxRadius=12,
    )
    x, y, conf = None, None, 0.0
    if circles is not None and len(circles) > 0:
        best_score = -1.0
        best_x = None
        best_y = None
        for c in circles[0]:
            cx = int(round(c[0]))
            cy = int(round(c[1]))
            if 0 <= cx < raw_map.shape[1] and 0 <= cy < raw_map.shape[0]:
                score = float(raw_map[cy, cx])
                if score > best_score:
                    best_score = score
                    best_x = c[0]
                    best_y = c[1]
        if best_x is not None and best_y is not None:
            x = best_x * scale
            y = best_y * scale
            conf = min(peak, 1.0)
    else:
        contours, _ = cv2.findContours(heatmap, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            contour = max(contours, key=cv2.contourArea)
            m = cv2.moments(contour)
            if m["m00"] > 0:
                cx = m["m10"] / m["m00"]
                cy = m["m01"] / m["m00"]
                x = cx * scale
                y = cy * scale
                conf = min(peak, 1.0)
    return x, y, conf


def remove_outliers(ball_track, dists, max_dist=150):
    """Remove outlier detections based on distance between neighbors.
    
    max_dist increased from 100 to 150 for ping pong (faster ball, closer camera).
    """
    outliers = list(np.where(np.array(dists) > max_dist)[0])
    for i in outliers:
        if i + 1 < len(dists) and ((dists[i + 1] > max_dist) or (dists[i + 1] == -1)):
            ball_track[i] = (None, None)
            if i in outliers:
                outliers.remove(i)
        elif dists[i - 1] == -1:
            ball_track[i - 1] = (None, None)
    return ball_track


def split_track(ball_track, max_gap=8, max_dist_gap=80, min_track=5):
    """Split ball track into subtracks for interpolation.
    
    max_gap increased from 4 to 8 for transfer learning (more detection gaps).
    """
    list_det = [0 if x[0] else 1 for x in ball_track]
    groups = [(k, sum(1 for _ in g)) for k, g in groupby(list_det)]

    cursor = 0
    min_value = 0
    result = []
    for i, (k, length) in enumerate(groups):
        if (k == 1) and (i > 0) and (i < len(groups) - 1):
            dist = distance.euclidean(ball_track[cursor - 1], ball_track[cursor + length])
            if (length >= max_gap) or (dist / length > max_dist_gap):
                if cursor - min_value > min_track:
                    result.append([min_value, cursor])
                    min_value = cursor + length - 1
        cursor += length
    if len(list_det) - min_value > min_track:
        result.append([min_value, len(list_det)])
    return result


def interpolation(coords):
    """Interpolate missing ball positions within a subtrack."""
    def nan_helper(y):
        return np.isnan(y), lambda z: z.nonzero()[0]

    x = np.array([c[0] if c[0] is not None else np.nan for c in coords])
    y = np.array([c[1] if c[1] is not None else np.nan for c in coords])

    nons, yy = nan_helper(x)
    if nons.any() and not nons.all():
        x[nons] = np.interp(yy(nons), yy(~nons), x[~nons])
    nans, xx = nan_helper(y)
    if nans.any() and not nans.all():
        y[nans] = np.interp(xx(nans), xx(~nans), y[~nans])

    return list(zip(x, y))


def bridge_segments(ball_track, subtracks, max_bridge_gap=15, max_bridge_dist=300):
    """Reconnect trajectory segments separated by hit events.
    
    When a player hits the ball, TrackNet often loses it for 3-10 frames,
    causing split_track to create separate segments. This function bridges
    adjacent segments using quadratic interpolation (parabolic arc) that
    models the ball decelerating into the hit and accelerating out.
    
    Args:
        ball_track: list of (x, y) or (None, None) per frame
        subtracks: list of [start, end] index pairs from split_track
        max_bridge_gap: max frames between segments to attempt bridging
        max_bridge_dist: max pixel distance between segment endpoints
    
    Returns:
        Updated ball_track with bridged gaps filled
    """
    if len(subtracks) < 2:
        return ball_track

    for i in range(len(subtracks) - 1):
        seg_end = subtracks[i][1] - 1    # last frame of current segment
        seg_start = subtracks[i + 1][0]  # first frame of next segment

        gap = seg_start - seg_end
        if gap <= 0 or gap > max_bridge_gap:
            continue

        pt_end = ball_track[seg_end]
        pt_start = ball_track[seg_start]

        if pt_end[0] is None or pt_start[0] is None:
            continue

        dist = distance.euclidean(pt_end, pt_start)
        if dist > max_bridge_dist:
            continue

        # Quadratic interpolation through the hit point
        # Use the velocity at each endpoint to shape the curve
        # Endpoint velocities (from last 2 points of each segment)
        vx_end, vy_end = 0.0, 0.0
        if seg_end >= subtracks[i][0] + 1 and ball_track[seg_end - 1][0] is not None:
            vx_end = pt_end[0] - ball_track[seg_end - 1][0]
            vy_end = pt_end[1] - ball_track[seg_end - 1][1]

        vx_start, vy_start = 0.0, 0.0
        if seg_start + 1 < subtracks[i + 1][1] and ball_track[seg_start + 1][0] is not None:
            vx_start = ball_track[seg_start + 1][0] - pt_start[0]
            vy_start = ball_track[seg_start + 1][1] - pt_start[1]

        # Fill gap frames with smooth interpolation
        for f in range(seg_end + 1, seg_start):
            t = (f - seg_end) / (seg_start - seg_end)  # 0 to 1
            # Hermite interpolation for smooth transition through direction change
            h00 = 2 * t**3 - 3 * t**2 + 1
            h10 = t**3 - 2 * t**2 + t
            h01 = -2 * t**3 + 3 * t**2
            h11 = t**3 - t**2
            span = seg_start - seg_end
            ix = h00 * pt_end[0] + h10 * vx_end * span + h01 * pt_start[0] + h11 * vx_start * span
            iy = h00 * pt_end[1] + h10 * vy_end * span + h01 * pt_start[1] + h11 * vy_start * span
            ball_track[f] = (ix, iy)

    return ball_track
