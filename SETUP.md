# PrepAI Setup Guide

## Database Schema

Run this SQL in the Supabase SQL Editor before doing anything else:

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Users table (mirrors Supabase auth.users)
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

-- RLS Policies
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

## 1. Supabase Setup

1. Go to https://supabase.com and create a new project
2. In the SQL Editor, run the entire SQL block above
3. Go to **Authentication → Providers → Google → Enable**
4. In Google Cloud Console (console.cloud.google.com):
   - Create a new project
   - Enable **Google+ API** (or "Google Identity" API)
   - Create **OAuth 2.0 credentials** (Web application type)
   - Authorized redirect URIs: add `https://yourproject.supabase.co/auth/v1/callback`
   - Copy Client ID and Client Secret back into Supabase Google provider settings
5. In Supabase → **Settings → API**:
   - Copy `Project URL` → this is `SUPABASE_URL`
   - Copy `anon public` key → this is `VITE_SUPABASE_ANON_KEY` (frontend)
   - Copy `service_role` key → this is `SUPABASE_SERVICE_ROLE_KEY` (backend)

---

## 2. Groq Setup

1. Go to https://console.groq.com
2. Create an API key
3. This is your `GROQ_API_KEY`

Models used:
- **STT**: `whisper-large-v3`
- **LLM**: `llama-3.3-70b-versatile`

---

## 3. Cartesia Setup

1. Go to https://cartesia.ai and sign up
2. Create an API key in the dashboard
3. This is your `CARTESIA_API_KEY`

Voice used: Christopher (`79a125e8-cd45-4c13-8a67-188112f4dd22`) — calm, authoritative.

---

## 4. Deploy Backend to Koyeb

1. Go to https://koyeb.com and sign up
2. **New App → GitHub** → select this repo
3. Set **root directory** to `backend`
4. Koyeb will auto-detect the Dockerfile
5. Add environment variables (all from `backend/.env.example`):
   - `GROQ_API_KEY`
   - `CARTESIA_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FRONTEND_URL` (set to your Vercel URL after deploying frontend)
6. Deploy — copy the generated URL (e.g. `https://prepai-xyz.koyeb.app`)
7. This becomes `VITE_BACKEND_URL` and `VITE_WS_URL` (use `wss://` for websocket)

---

## 5. Deploy Frontend to Vercel

1. Go to https://vercel.com → **New Project** → import this repo
2. Set **root directory** to `frontend`
3. Framework preset: **Vite**
4. Add environment variables (all from `frontend/.env.example`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_BACKEND_URL` — your Koyeb URL (e.g. `https://prepai-xyz.koyeb.app`)
   - `VITE_WS_URL` — same URL with `wss://` protocol (e.g. `wss://prepai-xyz.koyeb.app`)
5. Deploy
6. Copy the Vercel URL → go back to Koyeb env vars → set `FRONTEND_URL` to this → **redeploy backend**

---

## 6. Update Supabase Redirect URLs

1. Supabase → **Authentication → URL Configuration**
2. Add your Vercel URL to **Redirect URLs**: `https://your-prepai.vercel.app/**`
3. Set **Site URL** to your Vercel URL

---

## 7. Verify

- Visit your Vercel URL
- Sign in with Google
- Paste any job description and click **$ analyze --jd**
- Click **Start Interview →**
- The AI will speak the first question (green orb pulses)
- When the orb shows ripple rings, you're being recorded
- Click **[ done ]** when finished speaking
- Repeat for all questions
- View your scored performance report

---

## Environment Variable Reference

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key for STT + LLM |
| `CARTESIA_API_KEY` | Cartesia API key for TTS |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS) |
| `FRONTEND_URL` | Your Vercel deployment URL |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `VITE_BACKEND_URL` | Koyeb backend URL (https://) |
| `VITE_WS_URL` | Koyeb backend URL (wss://) |

---

## Troubleshooting

**WebSocket connection fails**
- Check that `VITE_WS_URL` uses `wss://` not `https://`
- Check Koyeb logs for Python errors on connect
- Ensure `FRONTEND_URL` in backend env matches your Vercel URL exactly

**Audio not playing**
- AudioContext requires a user gesture — it's initialized on the Start Interview button click
- Check browser console for `AudioContext` errors
- Ensure Cartesia API key is valid and has quota

**Scorecard not loading**
- Scorecard is generated after the final question — give it 5-10 seconds
- The Scorecard page retries 3 times with 2s delays
- Check backend logs for scorecard generation errors

**Google sign-in redirect loop**
- Ensure Supabase redirect URL includes `/**` wildcard
- Ensure Site URL in Supabase matches your Vercel URL exactly

**CORS errors**
- Ensure `FRONTEND_URL` env var in backend matches your Vercel URL
- Redeploy backend after updating env vars
