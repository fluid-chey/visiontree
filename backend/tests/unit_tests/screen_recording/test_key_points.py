"""Unit tests for screen recording key-point extraction."""

import json
from unittest.mock import patch

import pytest

from backend.screen_recording.key_points import extract_key_points


def test_extract_key_points_empty_transcript():
    """Empty transcript returns empty list."""
    assert extract_key_points("") == []
    assert extract_key_points("   \n  ") == []


def test_extract_key_points_valid_json():
    """Valid LLM-style JSON response is parsed into key points."""
    raw = json.dumps([
        {"timeSeconds": 0, "reason": "intro"},
        {"timeSeconds": 45.2, "reason": "main demo step"},
    ])
    with patch("backend.screen_recording.key_points._call_openai", return_value=raw):
        result = extract_key_points("[0.0s] Hello [45.2s] World")
    assert len(result) == 2
    assert result[0] == {"timeSeconds": 0.0, "reason": "intro"}
    assert result[1] == {"timeSeconds": 45.2, "reason": "main demo step"}


def test_extract_key_points_strips_markdown_fence():
    """Response wrapped in ```json ... ``` is stripped and parsed."""
    raw = '```json\n[{"timeSeconds": 1, "reason": "one"}]\n```'
    with patch("backend.screen_recording.key_points._call_openai", return_value=raw):
        result = extract_key_points("[1.0s] text")
    assert len(result) == 1
    assert result[0] == {"timeSeconds": 1.0, "reason": "one"}


def test_extract_key_points_invalid_json_returns_empty():
    """Invalid or malformed JSON returns empty list (no crash)."""
    with patch("backend.screen_recording.key_points._call_openai", return_value="not json"):
        result = extract_key_points("[0.0s] Hello")
    assert result == []


def test_extract_key_points_skips_invalid_entries():
    """Entries missing timeSeconds or reason are skipped."""
    raw = json.dumps([
        {"timeSeconds": 0, "reason": "ok"},
        {"reason": "no time"},
        {"timeSeconds": 5},
        {"timeSeconds": -1, "reason": "negative"},
        {"timeSeconds": 10, "reason": ""},
    ])
    with patch("backend.screen_recording.key_points._call_openai", return_value=raw):
        result = extract_key_points("[0.0s] Hello")
    assert len(result) == 1
    assert result[0] == {"timeSeconds": 0.0, "reason": "ok"}
