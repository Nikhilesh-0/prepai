# PrepAI — AI Mock Interviewer

A real-time voice-based AI mock interviewer. Paste a job description, speak your answers, and get scored.

## Features

- **Real-Time Voice Streaming:** Minimal latency STT/TTS pipeline using WebSockets.
- **Custom ML Answer Evaluator:** Includes a locally-trained, custom Naive Bayes classifier (`answer_evaluator.py`) that grades responses (Relevance, Depth, Structure) and dynamically controls follow-up question logic (e.g., prompting candidates when answers are vague or off-topic).
- **Synchronized UI:** Smooth typewriter text effects synced precisely with the audio playback, complete with a "Thinking..." indicator to mask backend processing latency.
- **Robust Audio Handling:** Implements precise PCM prerolls to prevent hardware noise gating and word-skipping during TTS playback.
- **Fault-Tolerant Sessions:** Interview state is continuously synced to Supabase, allowing users to refresh or reconnect without losing their place in the interview.

## Stack

- **Frontend**: React 18 + Vite + Tailwind CSS → Vercel
- **Backend**: FastAPI + WebSockets → Koyeb
- **STT**: Groq Whisper large-v3
- **LLM**: Groq LLaMA 3.3 70B (streaming)
- **TTS**: Cartesia Sonic
- **ML**: Custom Naive Bayes classification + Keyword Scoring Heuristics
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
                                ├── Custom Answer Evaluator (Naive Bayes)
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
  │← audio_response_chunk (b64) ──── │  ← TTS chunks (w/ PCM preroll)
  │← speaking_done ────────────────  │
  │── binary audio chunks ──────────→ │  ← MediaRecorder
  │── {type: "audio_end"} ──────────→ │
  │← transcript ────────────────────  │  ← Whisper STT
  │← answer_evaluation ───────────── │  ← Custom ML Classifier
  │← ai_text_chunk (streaming) ───── │
  │← audio_response_chunk (b64) ──── │
  │      ... (repeat per question)
  │← interview_complete ────────────  │
```
