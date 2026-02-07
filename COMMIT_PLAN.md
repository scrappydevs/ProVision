# Commit Plan - 7 Logical Commits

## Commit 1: Enhance pose estimation with MediaPipe and improved processing
**Files:**
- `backend/src/api/services/pose_service.py` (enhanced with video overlay, body metrics)
- `backend/src/api/services/pose_processor.py` (improvements)
- `backend/src/api/routes/pose.py` (enhanced endpoints)
- `backend/requirements.txt` (ensure mediapipe is included)

**Message:**
```
feat: enhance pose estimation with MediaPipe and improved processing

- Add video overlay generation to MediaPipe pose service
- Implement body metrics calculation (hip rotation, shoulder rotation, spine lean)
- Add frame sampling and preview frame extraction
- Improve pose processor compatibility and error handling
- Add player detection and preview generation capabilities
```

---

## Commit 2: Enhance stroke detection with multi-signal analysis
**Files:**
- `backend/src/api/services/stroke_detector.py` (multi-signal detection, smoothing)
- `backend/src/api/services/stroke_classifier.py` (improved classification)
- `backend/src/api/routes/stroke.py` (add confidence field support)

**Message:**
```
feat: enhance stroke detection with multi-signal analysis and signal processing

- Implement multi-signal detection combining wrist, elbow, and shoulder velocities
- Add signal smoothing with moving average filter
- Improve peak detection with combined signal validation
- Add confidence scoring for each detected stroke
- Enhance stroke classification with body position analysis
- Add post-processing to merge overlapping strokes and filter false positives
- Improve form scoring with optimal range bonuses
```

---

## Commit 3: Remove deprecated features and clean up codebase
**Files:**
- `backend/src/api/routes/wtt_data.py` (delete)
- `backend/src/api/services/match_scraper_service.py` (delete)
- `backend/src/scrapers/` (delete entire directory)
- `backend/migrations/009_wtt_database.sql` (delete)
- `frontend/src/app/dashboard/wtt/` (delete entire directory)
- `frontend/src/app/dashboard/activity/page.tsx` (delete)
- `frontend/src/app/dashboard/explore/page.tsx` (delete)
- `frontend/src/app/dashboard/stats/page.tsx` (delete)
- `backend/src/api/routes/__init__.py` (remove wtt_data import)
- `backend/src/api/main.py` (remove wtt_data router)

**Message:**
```
refactor: remove deprecated WTT and scraper features

- Remove WTT data routes and services
- Remove deprecated scraper modules
- Remove unused dashboard pages (activity, explore, stats, wtt)
- Clean up route imports and main app configuration
- Remove obsolete database migrations
```

---

## Commit 4: Add analytics features and components
**Files:**
- `backend/src/api/routes/analytics.py` (new)
- `backend/src/api/services/analytics_service.py` (new)
- `frontend/src/components/analytics/` (all new components)
- `frontend/src/components/analytics-overlay.tsx` (new)
- `backend/src/api/main.py` (add analytics router)
- `backend/src/api/routes/__init__.py` (add analytics import)

**Message:**
```
feat: add analytics dashboard and real-time analysis components

- Add analytics API routes for trajectory, movement, and speed analysis
- Implement analytics service with correlation and pattern detection
- Create analytics dashboard with multiple visualization components
- Add real-time analytics overlay for live game analysis
- Implement correlation grid for multi-metric analysis
```

---

## Commit 5: Update frontend viewer and player components
**Files:**
- `frontend/src/components/viewer/` (all viewer components)
- `frontend/src/components/players/` (all player components)
- `frontend/src/app/dashboard/games/[id]/page.tsx` (major updates)
- `frontend/src/app/dashboard/players/[id]/page.tsx` (updates)
- `frontend/src/hooks/` (new hooks directory)
- `frontend/src/lib/` (new lib directory)
- `frontend/src/types/` (new types directory)

**Message:**
```
feat: enhance frontend viewer and player components

- Improve game viewer with enhanced pose and stroke visualization
- Add dual video player with pose overlay support
- Enhance player detail pages with stats and timeline
- Add new React hooks for data fetching (usePoseData, useStrokeData, etc.)
- Implement viewer components (BirdEyeView, DualVideoPlayer, ShotCard, etc.)
- Add stroke timeline and tip visual overlays
```

---

## Commit 6: Update database schema and configuration
**Files:**
- `supabase_schema.sql` (schema updates)
- `backend/migrations/009_add_camera_facing.sql` (new migration)
- `backend/.env.example` (updated env vars)
- `frontend/.env.example` (updated env vars)
- `backend/src/api/database/` (new database utilities)

**Message:**
```
chore: update database schema and configuration

- Add camera facing field to sessions table
- Update Supabase schema with new analytics tables
- Update environment variable examples for new features
- Add database utility modules for better organization
```

---

## Commit 7: Improve services and clean up codebase
**Files:**
- `backend/src/api/services/sam2_service.py` (improvements)
- `backend/src/api/services/sam3d_service.py` (improvements)
- `backend/src/api/services/egox_service.py` (improvements)
- `backend/src/api/services/video_finder_service.py` (improvements)
- `backend/src/api/services/youtube_service.py` (improvements)
- `backend/src/api/services/ittf_service.py` (improvements)
- `backend/src/api/routes/sam2.py` (route updates)
- `backend/src/api/routes/sam3d.py` (route updates)
- `backend/src/api/routes/egox.py` (route updates)
- `backend/src/api/routes/sessions.py` (route updates)
- `backend/src/api/routes/tournaments.py` (route updates)
- `backend/src/api/routes/videos.py` (route updates)
- `backend/src/api/routes/players.py` (route updates)
- `backend/gpu_scripts/model_server.py` (improvements)
- `backend/src/engines/remote_run.py` (improvements)
- `backend/run.py` (cleanup)
- `frontend/src/app/dashboard/layout.tsx` (sidebar updates)
- `frontend/src/app/dashboard/page.tsx` (dashboard updates)
- `frontend/src/app/dashboard/teams/page.tsx` (updates)
- `frontend/src/app/dashboard/tournaments/page.tsx` (updates)
- `frontend/src/app/dashboard/settings/page.tsx` (updates)
- `frontend/src/components/layout/Header.tsx` (updates)
- `frontend/src/components/layout/Sidebar.tsx` (updates)
- `frontend/src/app/globals.css` (style updates)
- `frontend/src/app/page.tsx` (landing page updates)

**Message:**
```
refactor: improve services and clean up codebase

- Optimize SAM2 and SAM3D services with better error handling
- Improve EgoX service integration
- Enhance video finder and YouTube service reliability
- Update ITTF service with better data handling
- Refactor route handlers for consistency
- Update GPU model server scripts
- Improve remote engine execution
- Update dashboard layout and navigation
- Clean up unused code and improve code organization
- Update styling and UI components
```

---

## Summary

These 7 commits organize the changes into logical groups:
1. **Pose estimation enhancements** - Core AI feature improvements
2. **Stroke detection enhancements** - Core AI feature improvements  
3. **Deprecated code removal** - Cleanup
4. **Analytics features** - New feature addition
5. **Frontend components** - UI/UX improvements
6. **Database/config** - Infrastructure updates
7. **Service improvements** - Code quality and refactoring

Each commit is focused, testable, and follows conventional commit message format.
