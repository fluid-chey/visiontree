"""
Extract key moments from a timestamped transcript for screenshot placement.
Uses an LLM to pick times where a screenshot would be most useful.
"""

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

KEY_POINTS_SYSTEM = """You are given a transcript of a screen recording with timestamps.
Your task is to pick 3-8 key moments where taking a screenshot would help someone understand the content later.
Choose moments like: topic changes, important claims, demo steps, UI changes, or key conclusions.
Return a JSON array of objects, each with "timeSeconds" (number) and "reason" (string).
Only use times that appear in the transcript. Keep reasons short (a few words).
Example: [{"timeSeconds": 0, "reason": "intro"}, {"timeSeconds": 45.2, "reason": "main demo step"}]"""


def _call_openai(transcript: str) -> str:
    try:
        from openai import OpenAI
    except ImportError:
        raise RuntimeError("openai package not installed")
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=os.getenv("OPENAI_SCREEN_RECORDING_MODEL", "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": KEY_POINTS_SYSTEM},
            {"role": "user", "content": transcript},
        ],
        max_tokens=1024,
    )
    text = response.choices[0].message.content
    if not text:
        raise RuntimeError("Empty LLM response")
    return text.strip()


def extract_key_points(transcript: str) -> list[dict[str, Any]]:
    """
    Given a timestamped transcript string (e.g. "[0.0s] Hello [5.2s] World"),
    return a list of {"timeSeconds": float, "reason": str} for key moments.
    """
    if not transcript or not transcript.strip():
        return []
    raw = _call_openai(transcript)
    # Strip markdown code fence if present
    if raw.startswith("```"):
        lines = raw.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning("Key points JSON parse failed: %s", e)
        return []
    if not isinstance(data, list):
        return []
    result = []
    for item in data:
        if isinstance(item, dict):
            ts = item.get("timeSeconds")
            reason = item.get("reason")
            if isinstance(ts, (int, float)) and ts >= 0 and isinstance(reason, str) and reason.strip():
                result.append({"timeSeconds": float(ts), "reason": reason.strip()})
    return result
