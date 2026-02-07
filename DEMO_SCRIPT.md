# PROVISION - 5 Minute Video Demo Script

## Opening Hook (0:00 - 0:30)

**[Visual: Quick montage of table tennis action → PROVISION dashboard → AI insights appearing]**

**Voiceover:**
"There is so much sorts data out there, and programs for basketball, soccer, etc... But what about tennis. Every coaching session generates hours of footage. But finding the moments that matter? That takes even longer. PROVISION changes that. It's an AI-powered table tennis analytics platform that transforms match footage into actionable coaching insights — in minutes."

**[Title card: PROVISION - AI Sports Analysis]**

---

## The Problem (0:30 - 1:15)

**[Visual: Split screen showing old workflow vs. PROVISION workflow]**

"What if you could upload a match video and get professional-grade 3D biomechanics analysis, stroke detection, and personalized coaching tips — all generated automatically in minutes?"

---

## Platform Overview (1:15 - 2:00)

**[Visual: Upload a video to PROVISION]**

**Voiceover:**
"Here's how PROVISION works. Upload any table tennis video from your device — a match, practice session, or training drill."

**[Visual: Switch to YouTube URL input]**

"Or paste a YouTube URL and specify a clip range. PROVISION downloads the segment, processes it, and deletes the temporary file — all automatically."

**[Visual: Background processing indicators appearing]**

"The moment you hit upload, three AI pipelines activate in parallel:"

**[Visual: Show three progress indicators]**

1. **Ball Tracking** - "Our bidirectional TrackNet CNN — a deep learning model trained on tennis ball trajectories — runs forward and backward passes through the video, detecting 98% of frames even during fast rallies and spin shots. When TrackNet misses a frame, we have SAM2 segmentraiton and YOLO object detection to try fill the gap using sports ball class detection."

2. **Pose Analysis** - "YOLOv11-Pose tracks both players' full-body kinematics in real-time — 17 COCO keypoints per person extracted every 3rd frame. OpenCV processes the skeleton data to compute elbow angles, hip rotation, weight transfer, and footwork metrics."

3. **Forehand/Backhand Detection** - "The hybrid detection pipeline combines pose-based velocity analysis with Claude Vision AI. Claude analyzes 6 video frames per stroke to classify forehand vs. backhand, then computes form scores from the biomechanics extracted by YOLO-Pose."

---

## Live Demo: Game Analysis (2:00 - 3:30)

**[Visual: Game viewer page loading with a completed analysis]**

**Voiceover:**
"Let's see it in action. This is a 10-second clip we just analyzed."

**[Visual: Video playing with overlays]**

"The video player shows synchronized overlays rendered with HTML5 Canvas and React:"
- **Green ball trail** - "TrackNet trajectory with confidence-weighted bounding boxes, synced to the exact video frame using requestVideoFrameCallback"
- **Pose skeleton** - "YOLO-detected keypoints connected with OpenCV-computed joint angles, rendered as colored skeletons for player and opponent"
- **Stroke labels** - "Claude Vision-classified forehand and backhand labels with biomechanics-derived form scores"

**[Visual: Click through the side panel tabs]**

"The side panel gives you multiple views:"

**Pose & Strokes Tab:**
- "Live stroke indicator synced to the video frame"
- "Stroke breakdown showing forehand/backhand distribution"
- "AI-generated coaching insights for each stroke — notice how they appear at the exact moment the stroke happens"

**[Read one insight aloud]**
"'Your backhand shows excellent hip rotation at 32° through contact, but your elbow is bent at 108° — extending to 140-150° would increase racket-head speed.'"

**Court Tab:**
- "3D bird's-eye view built with React Three Fiber and Three.js — the ball follows TrackNet's trajectory in real-time with physics-based parabolic arc interpolation between detected frames"
- "Heatmap mode with Gaussian blur rendering showing impact density across the table surface"

**Analytics Tab:**
- "Speed analysis, movement patterns, correlation grids"
- "Contact height distribution, rally breakdowns"

---

## Player Profiles & Insights (3:30 - 4:15)

**[Visual: Navigate to Players page]**

**Voiceover:**
"PROVISION builds comprehensive player profiles from all their analyzed games."

**[Visual: Show player profile with stats]**

- "Forehand/backhand usage patterns"
- "Form score trends over time"
- "Strengths and weaknesses identified from biomechanics"

**[Visual: Click 'Generate Description']**

"The AI generates natural scouting reports: 'Prefers aggressive forehand topspin loops with strong hip rotation. Backhand needs development — struggles with low balls and cramped contact points.'"

**[Visual: Navigate to Compare page]**

"Need to prepare for a matchup? The Compare feature lets you analyze two players side-by-side."

**[Visual: Select two players and click 'Analyze Matchup']**

"PROVISION's AI analyzes both players' stroke analytics, playing styles, and historical performance to generate:"
- **Tactical advantages** - "Who has the edge and why"
- **Key matchup dynamics** - "Style clashes, technical mismatches"
- **Serve/receive gameplan** - "Specific tactics for the first 3 balls"
- **Rally strategy** - "Tempo preferences and length biases"

**[Visual: Show the radar chart comparing players across 5 dimensions]**

"The AI generates a comprehensive scouting report in seconds — no more manual spreadsheet comparisons."

---

## YouTube Integration & Tournaments (4:15 - 4:30)

**[Visual: Show YouTube Clips page]**

**Voiceover:**
"Found a pro match on YouTube you want to analyze? PROVISION's YouTube integration uses yt-dlp under the hood to download clips in the highest quality available."

**[Visual: Paste a YouTube URL, set start/end times]**

"Paste any YouTube URL, specify start and end times, and PROVISION automatically downloads the clip, runs it through the full analysis pipeline — TrackNet ball tracking, YOLO-Pose kinematics, Claude stroke classification — then generates analytics identical to uploaded videos."

**[Visual: Show a YouTube clip being created → analyzed → results appearing]**

"Perfect for studying pro technique, analyzing opponent footage from tournaments, or building a library of reference clips for your players. The downloaded clip is automatically cleaned up after processing to save storage."

**[Visual: Tournaments page showing matchup records]**

"Track your players' tournament performance with matchup records linked directly to analyzed game sessions. Every match becomes data you can learn from."

---

## Technical Capabilities (4:30 - 4:45)

**[Visual: Show architecture diagram or split-screen of frontend + backend + GPU]**

**Voiceover:**
"Under the hood, PROVISION combines cutting-edge computer vision and AI:"

- **RunPod A100 GPU** - "Running TrackNet CNN (PyTorch), YOLOv11-Pose (Ultralytics), and SAM2 (Meta's Segment Anything Model) for video object segmentation. All models run on CUDA for real-time inference."

- **OpenCV + NumPy** - "Frame extraction, pose skeleton rendering, biomechanics computation, and video processing at 53+ FPS"

- **Claude Haiku 3.5** - "Vision API for frame-by-frame stroke classification (forehand/backhand/no_hit) and detailed coaching insights analyzing contact point, hip rotation, and follow-through"

- **Supabase** - "PostgreSQL backend with real-time data sync, row-level security, and storage for videos and analytics"

- **Next.js + React** - "TypeScript frontend with Canvas API overlays, requestVideoFrameCallback for frame-accurate sync at 60 FPS, and React Three Fiber for 3D court visualization"

"The entire pipeline processes a 10-second clip in under 30 seconds — pose extraction, ball tracking via bidirectional TrackNet passes, stroke detection, and AI insights all generated automatically."

---

## Impact & Closing (4:45 - 5:00)

**[Visual: Montage of various analyzed games, player profiles, insights]**

**Voiceover:**
"PROVISION turns hours of manual video review into minutes of automated analysis. Coaches get detailed biomechanics feedback. Players see exactly what to improve. And everyone spends less time scrubbing through footage and more time actually training."

**[Visual: PROVISION logo]**

"PROVISION — AI-powered table tennis analytics."

**[End card with URL: tryprovision.vercel.app]**

---

## Demo Tips & Notes

### What to Show On-Screen

- **Use a real analyzed game** with good trajectory coverage (>80% ball detection)
- **Show the live insights appearing** as the video plays through a rally
- **Demonstrate the liquid glass ShotCard** floating during a stroke
- **Click on a timeline tip** to show the seek-to-moment feature
- **Toggle between Pose/Track/Court tabs** to show the versatility
- **Show the 3D court in Replay mode** synced to the video
- **Demo YouTube clip creation** with a real pro match URL
- **Show the Compare page** with two players selected and the matchup analysis generated
- **Show the radar chart** in the comparison view

### What to Emphasize

- **Speed** - "30 seconds to analyze a 10-second clip, all automatic"
- **Accuracy** - "98.4% ball detection rate, 17-point pose tracking"
- **Actionable insights** - Not just stats, but specific coaching feedback with angles and distances
- **Professional quality** - Biomechanics analysis that rivals motion capture labs

### Pacing

- Keep each section under the time budget
- Let the visuals breathe — don't rush through the UI
- Read one full AI insight to show the quality
- End on a strong value proposition

### Music/Audio

- Upbeat but professional background track
- Lower music volume during voiceover
- Consider ping-pong sound effects during the montage
