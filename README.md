# PrepAI — AI Mock Interviewer

A real-time voice-based AI mock interviewer. Paste a job description, speak your answers, get scored.

## Stack

- **Frontend**: React 18 + Vite + Tailwind CSS → Vercel
- **Backend**: FastAPI + WebSockets → Koyeb
- **STT**: Groq Whisper large-v3
- **LLM**: Groq LLaMA 3.3 70B (streaming)
- **TTS**: Cartesia Sonic
- **Auth + DB**: Supabase (Google OAuth + Postgres)

## Setup

See [SETUP.md](./SETUP.md) for the full deployment guide.

## Local Development

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env       # fill in your keys
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # fill in your keys
npm run dev
```

Visit http://localhost:5173

## Architecture

```
User Browser
    │
    ├── REST (HTTPS) ──→ FastAPI /api/*
    │                        └── Supabase Postgres
    │
    └── WebSocket (WSS) ──→ FastAPI /ws/interview/{session_id}
                                ├── Groq Whisper (STT)
                                ├── Groq LLaMA 3.3 70B (LLM, streaming)
                                └── Cartesia Sonic (TTS, streaming)
```

### WebSocket Message Flow

```
Client                              Server
  │── connect ──────────────────────→ │
  │← state_update ────────────────── │
  │← ai_text_chunk (streaming) ───── │  ← LLM streams
  │← audio_response_chunk (b64) ──── │  ← TTS chunks
  │← speaking_done ────────────────  │
  │── binary audio chunks ──────────→ │  ← MediaRecorder
  │── {type: "audio_end"} ──────────→ │
  │← transcript ────────────────────  │  ← Whisper
  │← ai_text_chunk (streaming) ───── │
  │← audio_response_chunk (b64) ──── │
  │      ... (repeat per question)
  │← interview_complete ────────────  │
```
