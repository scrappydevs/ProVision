import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from .routes import sessions, sam2, sam3d, egox, pose, stroke, players, ai_chat, recordings, tournaments, analytics, videos

app = FastAPI(
    title="ProVision API",
    description="AI-powered sports analysis backend",
    version="0.1.0",
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(sam2.router, prefix="/api/sam2", tags=["sam2"])
app.include_router(sam3d.router, tags=["sam3d"])  # Already has /api/sam3d prefix
app.include_router(egox.router, prefix="/api/egox", tags=["egox"])
app.include_router(pose.router, prefix="/api/pose", tags=["pose"])
app.include_router(stroke.router, prefix="/api/stroke", tags=["stroke"])
app.include_router(players.router, prefix="/api/players", tags=["players"])
app.include_router(ai_chat.router, prefix="/api/ai", tags=["ai"])
app.include_router(recordings.router, prefix="/api/recordings", tags=["recordings"])
app.include_router(tournaments.router, prefix="/api/tournaments", tags=["tournaments"])
app.include_router(analytics.router, tags=["analytics"])  # Already has /api/analytics prefix
app.include_router(videos.router, prefix="/api/videos", tags=["videos"])


@app.get("/")
async def root():
    return {"message": "ProVision API", "version": "0.1.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/api/config")
async def get_config():
    return {
        "supabase_url": os.getenv("SUPABASE_URL", ""),
        "supabase_anon_key": os.getenv("SUPABASE_ANON_KEY", ""),
    }
