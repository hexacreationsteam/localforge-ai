# LocalForge AI — Vercel Edition

LocalForge AI multi-model workspace adapted for Vercel (Vite frontend + Edge API routes).

## Features retained

- React/Vite UI, browser Ollama, IndexedDB/local RAG, PWA
- Server-side API keys for Gemini, OpenAI, xAI (Grok), Anthropic
- SSE streaming chat at `/api/chat/stream`
- Provider fallback to Gemini when configured
- Health and models status endpoints

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import the project in Vercel (or link via the dashboard / CLI).
3. Add **Environment Variables** (Project → Settings → Environment Variables):

   | Name | Required | Notes |
   |------|----------|-------|
   | `GEMINI_API_KEY` | Recommended | Google AI Studio key |
   | `OPENAI_API_KEY` | Optional | |
   | `XAI_API_KEY` | Optional | xAI / Grok |
   | `ANTHROPIC_API_KEY` | Optional | Claude |
   | `GEMINI_MODEL` | Optional | default `gemini-2.5-flash` |
   | `OPENAI_MODEL` | Optional | default `gpt-4o` |
   | `XAI_MODEL` | Optional | default `grok-3-mini` |
   | `ANTHROPIC_MODEL` | Optional | default `claude-sonnet-4-5` |
   | `MEGA_SERVICE_URL` | Optional | Private MEGA bridge |
   | `MEGA_SERVICE_TOKEN` | Optional | Same token as the MEGA service |

4. Redeploy after adding secrets.

## Local development

```bash
npm install
cp .env.example .env.local   # put keys here for local API testing if you run a separate server
npm run dev
```

The Vite dev server serves the UI. For full API testing against real providers, deploy to Vercel or run the Edge functions via `vercel dev` (requires Vercel CLI).

## API endpoints

- `GET /api/health`
- `GET /api/models/status`
- `POST /api/chat/stream` (Server-Sent Events)
- `GET|POST /api/storage/mega/*` (proxy to optional private MEGA service)
- `GET /api/live` (returns 501 — browser speech fallback)

## Provider routing

| UI selection | Provider | Env var |
|---|---|---|
| Forge / Gemini | Google Gemini | `GEMINI_API_KEY` |
| GPT | OpenAI | `OPENAI_API_KEY` |
| Grok | xAI | `XAI_API_KEY` |
| Claude | Anthropic | `ANTHROPIC_API_KEY` |

## Notes

- Conversations and Knowledge Base stay in the browser (IndexedDB).
- Ollama is browser-local only.
- Live Voice uses the offline browser speech path.
- Keep API keys in Vercel environment variables only — never in client code.
