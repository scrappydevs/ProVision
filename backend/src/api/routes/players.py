from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..database.supabase import get_supabase, get_current_user_id

router = APIRouter()


class PlayerInsightsResponse(BaseModel):
    player_id: str
    total_games: int
    total_strokes: int
    forehand_stats: dict
    backhand_stats: dict
    strengths: List[dict]
    weaknesses: List[dict]


@router.get("/insights/{player_id}")
async def get_player_insights(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Generate personalized insights for a player based on their stroke analytics.
    """
    supabase = get_supabase()
    
    # Verify player belongs to coach
    player_result = supabase.table("players").select("id").eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player_result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    
    # Get all games for this player
    games_result = supabase.table("game_players").select("game_id").eq("player_id", player_id).execute()
    game_ids = [g["game_id"] for g in games_result.data] if games_result.data else []
    
    if not game_ids:
        return PlayerInsightsResponse(
            player_id=player_id,
            total_games=0,
            total_strokes=0,
            forehand_stats={},
            backhand_stats={},
            strengths=[],
            weaknesses=[],
        )
    
    # Get stroke analytics for all games
    strokes_result = supabase.table("stroke_analytics")\
        .select("stroke_type, form_score, metrics")\
        .in_("session_id", game_ids)\
        .execute()
    
    strokes = strokes_result.data if strokes_result.data else []
    
    # Aggregate statistics
    forehand_strokes = [s for s in strokes if s["stroke_type"] == "forehand"]
    backhand_strokes = [s for s in strokes if s["stroke_type"] == "backhand"]
    
    forehand_stats = {
        "count": len(forehand_strokes),
        "avg_form_score": sum(s["form_score"] for s in forehand_strokes) / len(forehand_strokes) if forehand_strokes else 0,
        "best_form_score": max((s["form_score"] for s in forehand_strokes), default=0),
    }
    
    backhand_stats = {
        "count": len(backhand_strokes),
        "avg_form_score": sum(s["form_score"] for s in backhand_strokes) / len(backhand_strokes) if backhand_strokes else 0,
        "best_form_score": max((s["form_score"] for s in backhand_strokes), default=0),
    }
    
    # Generate insights
    strengths = []
    weaknesses = []
    
    # Forehand analysis
    if forehand_stats["avg_form_score"] > 75:
        strengths.append({
            "title": "Forehand power",
            "summary": f"Consistent forehand technique with {forehand_stats['avg_form_score']:.1f}% average form score",
            "metric": f"Best: {forehand_stats['best_form_score']:.1f}%",
        })
    elif forehand_stats["count"] > 0:
        weaknesses.append({
            "title": "Forehand consistency",
            "summary": f"Form score averaging {forehand_stats['avg_form_score']:.1f}% - room for improvement",
            "metric": "Focus on hip rotation and follow-through",
        })
    
    # Backhand analysis
    if backhand_stats["avg_form_score"] > 75:
        strengths.append({
            "title": "Backhand technique",
            "summary": f"Strong backhand form with {backhand_stats['avg_form_score']:.1f}% average score",
            "metric": f"Best: {backhand_stats['best_form_score']:.1f}%",
        })
    elif backhand_stats["count"] > 0:
        weaknesses.append({
            "title": "Backhand development",
            "summary": f"Form score averaging {backhand_stats['avg_form_score']:.1f}% - focus area",
            "metric": "Work on contact point and weight transfer",
        })
    
    # Stroke balance
    total = forehand_stats["count"] + backhand_stats["count"]
    if total > 0:
        fh_pct = (forehand_stats["count"] / total) * 100
        if fh_pct > 70:
            strengths.append({
                "title": "Forehand reliance",
                "summary": f"{fh_pct:.0f}% of strokes are forehands - dominant weapon",
                "metric": "Maintain this strength in pressure situations",
            })
            weaknesses.append({
                "title": "Backhand usage",
                "summary": f"Only {100-fh_pct:.0f}% backhands - develop for balance",
                "metric": "Add backhand drills to training routine",
            })
        elif fh_pct < 30:
            strengths.append({
                "title": "Backhand reliance",
                "summary": f"{100-fh_pct:.0f}% of strokes are backhands - strong side",
                "metric": "Leverage this in match strategy",
            })
            weaknesses.append({
                "title": "Forehand development",
                "summary": f"Only {fh_pct:.0f}% forehands - balance needed",
                "metric": "Incorporate more forehand practice",
            })
    
    return PlayerInsightsResponse(
        player_id=player_id,
        total_games=len(game_ids),
        total_strokes=len(strokes),
        forehand_stats=forehand_stats,
        backhand_stats=backhand_stats,
        strengths=strengths[:4],  # Limit to 4 strengths
        weaknesses=weaknesses[:2],  # Limit to 2 weaknesses
    )
