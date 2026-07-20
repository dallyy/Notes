import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = BASE_DIR / "uploads"
NOTES_PATH = DATA_DIR / "notes.json"
SETTINGS_PATH = DATA_DIR / "settings.json"

# ensure data directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()


# data helpers

def _read_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def _write_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_notes() -> list[dict]:
    return _read_json(NOTES_PATH, [])


def _save_notes(notes: list[dict]):
    _write_json(NOTES_PATH, notes)


def _load_settings() -> dict:
    return _read_json(SETTINGS_PATH, {"background_image": None, "blur": 0, "transparency": 1.0, "theme": "cyan"})


def _save_settings(settings: dict):
    _write_json(SETTINGS_PATH, settings)


# models

class NoteCreate(BaseModel):
    title: str = ""
    content: str = ""


class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None


class SettingsUpdate(BaseModel):
    blur: int | None = None
    transparency: float | None = None
    theme: str | None = None


# page

@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "templates" / "index.html")


# notes api

@app.get("/api/notes")
async def list_notes():
    return _load_notes()


@app.post("/api/notes")
async def create_note(note: NoteCreate):
    notes = _load_notes()
    now = datetime.now(timezone.utc).isoformat()
    new_note = {
        "id": uuid.uuid4().hex,
        "title": note.title,
        "content": note.content,
        "created_at": now,
        "updated_at": now,
    }
    notes.append(new_note)
    _save_notes(notes)
    return new_note


@app.put("/api/notes/{note_id}")
async def update_note(note_id: str, note: NoteUpdate):
    notes = _load_notes()
    for n in notes:
        if n["id"] == note_id:
            if note.title is not None:
                n["title"] = note.title
            if note.content is not None:
                n["content"] = note.content
            n["updated_at"] = datetime.now(timezone.utc).isoformat()
            _save_notes(notes)
            return n
    raise HTTPException(status_code=404, detail="Note not found")


@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str):
    notes = _load_notes()
    filtered = [n for n in notes if n["id"] != note_id]
    if len(filtered) == len(notes):
        raise HTTPException(status_code=404, detail="Note not found")
    _save_notes(filtered)
    return {"ok": True}


# settings api

@app.get("/api/settings")
async def get_settings():
    return _load_settings()


@app.put("/api/settings")
async def update_settings(settings: SettingsUpdate):
    current = _load_settings()
    if settings.blur is not None:
        current["blur"] = max(0, min(20, settings.blur))
    if settings.transparency is not None:
        current["transparency"] = max(0.1, min(1.0, settings.transparency))
    if settings.theme is not None:
        current["theme"] = settings.theme
    _save_settings(current)
    return current


@app.post("/api/upload-background")
async def upload_background(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        raise HTTPException(status_code=400, detail="Unsupported image format")
    filename = f"bg_{uuid.uuid4().hex}{ext}"
    content = await file.read()
    (UPLOADS_DIR / filename).write_bytes(content)
    settings = _load_settings()
    settings["background_image"] = filename
    _save_settings(settings)
    return {"filename": filename}


@app.delete("/api/background")
async def remove_background():
    settings = _load_settings()
    old = settings.get("background_image")
    if old:
        old_path = UPLOADS_DIR / old
        if old_path.exists():
            old_path.unlink()
    settings["background_image"] = None
    _save_settings(settings)
    return {"ok": True}


# static files

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
