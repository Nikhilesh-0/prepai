# PrepAI — AI Mock Interviewer

A real-time, voice-based AI mock interviewer. Paste a job description, speak your answers, and receive a scored performance report with deterministic analysis.

**Live demo:** [prepai-navy.vercel.app](https://prepai-navy.vercel.app)

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS → Vercel |
| Backend | FastAPI + WebSockets → Render (Dockerized) |
| Speech-to-Text | Groq `whisper-large-v3` |
| LLM | Groq `llama-3.3-70b-versatile` (streaming) |
| Text-to-Speech | Cartesia `sonic-english`, voice: Christopher (`79a125e8`) |
| Auth + DB | Supabase (Google OAuth + Postgres + RLS) |
| Answer Evaluation | Deterministic NLP (NLTK, scikit-learn TF-IDF) + joblib-loaded RF model |

---

## Architecture

```
User Browser
    │
    ├── REST (HTTPS) ──────────→ FastAPI /api/*
    │                               ├── POST /api/sessions      (JD parse + question gen)
    │                               ├── GET  /api/sessions/:uid (session history)
    │                               └── GET  /api/scorecard/:id (fetch results)
    │
    └── WebSocket (WSS) ────────→ FastAPI /ws/interview/{session_id}
                                      ├── Groq Whisper large-v3  (STT)
                                      ├── Groq LLaMA 3.3 70B     (LLM, streaming)
                                      └── Cartesia sonic-english  (TTS, PCM f32le @ 44100Hz)
```

### WebSocket Message Flow

```
Client                                    Server
  │── connect ────────────────────────────→ │
  │← state_update ──────────────────────── │
  │── { type: "client_ready" } ───────────→ │
  │← ai_text_chunk  (streaming)  ───────── │  ← LLM streams
  │← audio_response_chunk (base64 PCM) ─── │  ← TTS chunks
  │← speaking_done ─────────────────────── │
  │                                         │
  │  [user speaks]                          │
  │── binary audio frames (WebM/Opus) ────→ │  ← MediaRecorder @ 250ms slices
  │── { type: "audio_end" } ──────────────→ │
  │← transcript ────────────────────────── │  ← Whisper
  │← answer_evaluation ─────────────────── │  ← deterministic evaluator
  │← ai_text_chunk / audio_response_chunk ─ │  ← next question or follow-up
  │      ... (repeat per question)
  │── { type: "ping" } ───────────────────→ │  ← keepalive every 25s
  │← { type: "pong" } ──────────────────── │
  │← interview_complete ────────────────── │  ← with full scorecard payload
```

---

## How It Works

### 1. JD Analysis (`POST /api/sessions`)
The job description is sent to LLaMA 3.3 70B which extracts a structured `interview_profile`: role title, seniority level (junior/mid/senior), tech stack, domain, soft skill signals, and company type. A question plan of 8–9 questions is then generated — 2 HR/culture, 3–4 technical (stack-specific), 2 behavioral (STAR-prompt), 1 closing — and persisted to Supabase alongside the session.

### 2. Live Interview (`/ws/interview/{session_id}`)
The WebSocket connection drives the full interview loop:

- **AI turn:** LLM response streams token-by-token and is simultaneously forwarded to the client as `ai_text_chunk` messages. A smart sentence-boundary splitter (abbreviation-aware) feeds text chunks to Cartesia TTS, which streams back raw PCM float32 little-endian at 44100 Hz. The frontend Web Audio API schedules these chunks seamlessly with a two-phase playback poller that accounts for Bluetooth hardware output buffers.
- **User turn:** `MediaRecorder` captures audio in 250ms slices sent as binary WebSocket frames. On `audio_end`, the buffer is sent to Groq Whisper for transcription.
- **Follow-up logic:** Each answer is evaluated by a deterministic NLP evaluator (see below). If the answer is too vague, off-topic, or missing a measurable outcome, the LLM is privately signalled to ask one targeted follow-up (max 1 per question).
- **Session recovery:** If a WebSocket reconnects to an existing `session_id`, the server restores full state from Supabase — questions, prior responses, and conversation history — so interviews can survive brief disconnections.
- **Retry handling:** Up to 3 consecutive failed transcriptions (empty audio, mic noise, Groq parse error) before a question is recorded as `(no response)` and the interview advances automatically.

### 3. Answer Evaluation (Deterministic)
Each answer is evaluated in real-time using `answer_evaluator.py` — no extra LLM call:

- **STAR structure detection** — checks for situation/task, action, and result cues
- **Specificity scoring** — counts numeric metrics, tech terms (from a curated vocabulary), and temporal anchors using regex
- **Lexical diversity** — root type-token ratio (TTR) via NLTK
- **Discourse coherence** — transition marker categories (sequential, causal, contrast)
- **Relevance** — TF-IDF cosine similarity between question and answer

Labels: `strong`, `adequate`, `vague`, `off_topic`, `too_short`, `no_response`, `skipped`.

### 4. Scorecard Generation
After the final question, a joblib-loaded Random Forest model takes aggregate features from all per-answer evaluations (mean TTR, total tech terms, filler counts, etc.) to produce deterministic numeric scores for overall, technical, communication, and confidence dimensions. These scores are passed to LLaMA 3.3 70B as ground truth — the LLM is instructed to generate text feedback that is **consistent with the numeric scores**, not the other way around. The scorecard is persisted to Supabase and displayed as a single overall performance report: four score rings, filler word count, strengths, areas for improvement, a written summary, and per-dimension detailed feedback.

---

## Frontend Routes

| Route | Page |
|---|---|
| `/` | Landing — Google sign-in |
| `/dashboard` | Session history + stats |
| `/new` | JD input + profile preview |
| `/interview/:sessionId` | Live interview UI |
| `/scorecard/:sessionId` | Performance report |

All routes except `/` are wrapped in `AuthGuard` (Supabase session check). The interview page additionally wraps in a React `ErrorBoundary`. The scorecard page retries up to 5 times with 3-second delays to allow async scorecard generation to finish.

---

## Local Development

### Prerequisites
- Python 3.11+
- Node.js 18+
- A Supabase project (see [Database Setup](#database-setup))
- API keys for Groq and Cartesia

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # fill in your keys
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local      # fill in your keys
npm run dev
```

Visit `http://localhost:5173`

### Environment Variables

**Backend (`backend/.env`)**

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key (STT + LLM) |
| `CARTESIA_API_KEY` | Cartesia API key (TTS) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — bypasses RLS, keep secret |
| `FRONTEND_URL` | Your frontend URL (used for CORS) |

**Frontend (`frontend/.env.local`)**

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `VITE_BACKEND_URL` | Backend URL (`https://...`) |
| `VITE_WS_URL` | Backend WebSocket URL (`wss://...`) |

---

## Database Setup

Run this SQL in the Supabase SQL Editor before anything else:

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Users table (mirrors auth.users)
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

-- Sessions table
create table public.sessions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  jd_text text not null,
  role_title text,
  level text check (level in ('junior', 'mid', 'senior')),
  domain text,
  tech_stack text[],
  status text default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Questions table
create table public.questions (
  id uuid default uuid_generate_v4() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  question_text text not null,
  question_type text check (question_type in ('hr', 'behavioral', 'technical')),
  order_index integer not null,
  follow_up_hint text,
  created_at timestamptz default now()
);

-- Responses table
create table public.responses (
  id uuid default uuid_generate_v4() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  question_id uuid references public.questions(id) on delete cascade not null,
  transcript text not null,
  duration_seconds integer,
  created_at timestamptz default now()
);

-- Scorecards table
create table public.scorecards (
  id uuid default uuid_generate_v4() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  overall_score integer check (overall_score between 0 and 100),
  communication_score integer check (communication_score between 0 and 100),
  technical_score integer check (technical_score between 0 and 100),
  confidence_score integer check (confidence_score between 0 and 100),
  filler_word_count integer default 0,
  strengths jsonb,
  improvements jsonb,
  summary text,
  detailed_feedback jsonb,
  created_at timestamptz default now()
);

-- RLS policies
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.questions enable row level security;
alter table public.responses enable row level security;
alter table public.scorecards enable row level security;

create policy "Users can read own data" on public.users for select using (auth.uid() = id);
create policy "Users can read own sessions" on public.sessions for select using (auth.uid() = user_id);
create policy "Users can insert own sessions" on public.sessions for insert with check (auth.uid() = user_id);
create policy "Users can update own sessions" on public.sessions for update using (auth.uid() = user_id);
create policy "Users can read own questions" on public.questions for select using (
  exists (select 1 from public.sessions where sessions.id = questions.session_id and sessions.user_id = auth.uid())
);
create policy "Users can read own responses" on public.responses for select using (
  exists (select 1 from public.sessions where sessions.id = responses.session_id and sessions.user_id = auth.uid())
);
create policy "Users can read own scorecards" on public.scorecards for select using (
  exists (select 1 from public.sessions where sessions.id = scorecards.session_id and sessions.user_id = auth.uid())
);

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

---

## Deployment

### Backend → Render

1. Go to [render.com](https://render.com) → **New → Web Service** → connect this repo
2. Set **Root Directory** to `backend`
3. Render auto-detects the `Dockerfile` (Python 3.11-slim, uvicorn on port 8000)
4. Add all backend environment variables
5. Set `FRONTEND_URL` to your Vercel URL after deploying the frontend
6. Deploy — copy the generated `https://prepai-xyz.onrender.com` URL

> **Note:** Render free-tier web services spin down after inactivity. The WebSocket keepalive ping (every 25s) helps prevent idle disconnections during active interviews, but the first request after a cold start may take ~30s.

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → import this repo
2. Set **root directory** to `frontend`, framework preset to **Vite**
3. Add all frontend environment variables:
   - `VITE_BACKEND_URL` → your Render URL (`https://...`)
   - `VITE_WS_URL` → same URL with `wss://` protocol
4. Deploy — copy the Vercel URL
5. Go back to Render → update `FRONTEND_URL` to the Vercel URL → **redeploy backend**

### Supabase: Post-Deployment

1. **Authentication → Providers → Google** → enable and configure OAuth credentials (Google Cloud Console → OAuth 2.0 Web client → add `https://yourproject.supabase.co/auth/v1/callback` as redirect URI)
2. **Authentication → URL Configuration** → set **Site URL** to your Vercel URL; add `https://your-prepai.vercel.app/**` to **Redirect URLs**

---

## Troubleshooting

**WebSocket connection fails**
- Confirm `VITE_WS_URL` uses `wss://` not `https://`
- Check Render logs for Python errors on connect
- Ensure `FRONTEND_URL` in the backend env exactly matches your Vercel URL (CORS)

**Audio not playing**
- `AudioContext` is initialized on the "Start Interview" button click — it requires a user gesture
- Check browser console for `AudioContext` or `NotAllowedError` messages
- Verify your Cartesia API key is valid and has quota remaining

**Scorecard not loading**
- Scorecard is generated asynchronously after the final question — the frontend retries 5 times with 3s delays
- Check backend logs for scorecard generation or JSON parse errors

**Bluetooth audio issues**
- The app uses a per-turn mic acquisition strategy: the mic stream is released immediately after `audio_end` so Bluetooth headsets can switch back from HFP to A2DP for AI audio playback
- A silent keepalive oscillator prevents the Bluetooth noise gate from engaging during silence

**Google sign-in redirect loop**
- Ensure the Supabase Redirect URL includes the `/**` wildcard
- Ensure the Site URL in Supabase matches your Vercel URL exactly (no trailing slash mismatch)

**CORS errors**
- Ensure `FRONTEND_URL` in the backend env matches your Vercel URL exactly
- Redeploy the backend on Render after updating env vars