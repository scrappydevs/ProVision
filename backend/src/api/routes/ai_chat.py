import os
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..database.supabase import get_supabase, get_current_user_id

router = APIRouter()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

SYSTEM_PROMPT = """You are an AI sports analyst for ProVision, a ping pong / table tennis analysis platform.
You have access to tools that let you query game data. When the user asks about a game, use the appropriate tools.

Available data you can reference:
- Ball trajectory (position per frame, velocity, spin estimate)
- Pose analysis (skeleton keypoints, joint angles, body metrics)
- Session/game metadata (name, status, video path)

Be concise but insightful. Use sports coaching terminology. Format responses with markdown bold for key terms.
When giving technique advice, be specific and actionable."""

TOOLS = [
    {
        "name": "get_ball_trajectory",
        "description": "Get ball tracking trajectory data including position per frame, velocity, and spin estimate",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "The game session ID"}
            },
            "required": ["session_id"]
        }
    },
    {
        "name": "get_pose_data",
        "description": "Get player pose analysis data including skeleton keypoints and joint angles",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "The game session ID"}
            },
            "required": ["session_id"]
        }
    },
    {
        "name": "get_game_info",
        "description": "Get game session metadata including name, status, and available analysis",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "The game session ID"}
            },
            "required": ["session_id"]
        }
    },
    {
        "name": "analyze_technique",
        "description": "Analyze player technique based on pose and trajectory data, providing coaching tips",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "The game session ID"},
                "focus": {"type": "string", "description": "What to focus on: stroke, footwork, positioning, serve"}
            },
            "required": ["session_id"]
        }
    }
]


def execute_tool(tool_name: str, tool_input: dict, user_id: str) -> str:
    supabase = get_supabase()
    session_id = tool_input.get("session_id", "")

    try:
        if tool_name == "get_ball_trajectory":
            result = supabase.table("sessions").select("trajectory_data").eq("id", session_id).eq("user_id", user_id).single().execute()
            if not result.data or not result.data.get("trajectory_data"):
                return "No trajectory data available. The ball has not been tracked yet."
            td = result.data["trajectory_data"]
            frames = td.get("frames", [])
            velocity = td.get("velocity", [])
            spin = td.get("spin_estimate", "unknown")
            avg_speed = sum(velocity) / len(velocity) if velocity else 0
            peak_speed = max(velocity) if velocity else 0
            return f"Trajectory: {len(frames)} frames tracked. Avg speed: {avg_speed:.1f} px/f. Peak speed: {peak_speed:.1f} px/f. Spin: {spin}."

        elif tool_name == "get_pose_data":
            result = supabase.table("sessions").select("pose_data, pose_video_path, status").eq("id", session_id).eq("user_id", user_id).single().execute()
            if not result.data:
                return "Session not found."
            has_pose = bool(result.data.get("pose_video_path"))
            status = result.data.get("status", "unknown")
            pose = result.data.get("pose_data", {})
            joint_angles = pose.get("joint_angles", {})
            angle_summary = ", ".join(f"{k}: {v[-1]:.0f}°" for k, v in list(joint_angles.items())[:4] if v) if joint_angles else "No joint angle data"
            return f"Pose analysis: {'Available' if has_pose else 'Not available'}. Status: {status}. Joint angles: {angle_summary}."

        elif tool_name == "get_game_info":
            result = supabase.table("sessions").select("name, status, video_path, ego_video_path, pose_video_path, trajectory_data").eq("id", session_id).eq("user_id", user_id).single().execute()
            if not result.data:
                return "Session not found."
            d = result.data
            has_traj = bool(d.get("trajectory_data", {}).get("frames"))
            return f"Game: {d['name']}. Status: {d['status']}. Has video: {bool(d.get('video_path'))}. Has pose: {bool(d.get('pose_video_path'))}. Has trajectory: {has_traj}."

        elif tool_name == "analyze_technique":
            focus = tool_input.get("focus", "general")
            result = supabase.table("sessions").select("trajectory_data, pose_data").eq("id", session_id).eq("user_id", user_id).single().execute()
            if not result.data:
                return "Session not found."
            td = result.data.get("trajectory_data", {})
            spin = td.get("spin_estimate", "unknown")
            velocity = td.get("velocity", [])
            avg_speed = sum(velocity) / len(velocity) if velocity else 0
            return f"Technique analysis (focus: {focus}). Ball spin: {spin}, avg speed: {avg_speed:.1f} px/f. Ready for coaching recommendations."

        else:
            return f"Unknown tool: {tool_name}"
    except Exception as e:
        return f"Tool error: {str(e)}"


class ChatRequest(BaseModel):
    message: str
    session_id: str
    history: Optional[List[dict]] = None


class ChatResponse(BaseModel):
    response: str
    tool_calls: List[dict] = []


@router.post("/chat", response_model=ChatResponse)
async def ai_chat(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_id),
):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Build messages from history
    messages = []
    if request.history:
        for msg in request.history[-10:]:  # Last 10 messages for context
            if msg.get("role") in ("user", "assistant"):
                messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": request.message})

    # Multi-round tool calling (up to 3 rounds)
    all_tool_calls = []
    for _ in range(3):
        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1024,
                system=SYSTEM_PROMPT + f"\n\nCurrent game session_id: {request.session_id}",
                tools=TOOLS,
                messages=messages,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Anthropic API error: {str(e)}")

        # Check if there are tool calls
        has_tool_use = any(block.type == "tool_use" for block in response.content)

        if not has_tool_use:
            # Extract text response
            text = "".join(block.text for block in response.content if block.type == "text")
            return ChatResponse(response=text, tool_calls=all_tool_calls)

        # Process tool calls
        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                tool_result = execute_tool(block.name, block.input, user_id)
                all_tool_calls.append({
                    "name": block.name,
                    "input": block.input,
                    "result": tool_result,
                })
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": tool_result,
                })

        messages.append({"role": "user", "content": tool_results})

    # If we exhausted rounds, get final text
    text = "".join(block.text for block in response.content if block.type == "text")
    return ChatResponse(response=text or "I processed the data but couldn't generate a summary. Try asking a more specific question.", tool_calls=all_tool_calls)
