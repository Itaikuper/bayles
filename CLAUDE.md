# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bayles is a WhatsApp bot built with Baileys (`@whiskeysockets/baileys`), Google Gemini AI, and a React dashboard. It supports multi-tenant operation, scheduled messages, Google Calendar integration, birthday greetings, a song/chords database, and per-chat AI configuration. The primary language context is Hebrew.

## Build & Run Commands

```bash
npm run dev          # Development with watch mode (tsx watch)
npm run start        # Run from TypeScript source (tsx)
npm run build        # Compile TypeScript to dist/
npm run start:prod   # Run compiled JS from dist/
npm run import-songs # Bulk import songs from src/scripts/import-songs.ts
```

Production deployment uses PM2 via `ecosystem.config.cjs` (300MB memory limit). There are no tests or linting configured.

## Production Server (Google Compute Engine)

- **GCP Project**: `gen-lang-client-0072875231`
- **VM Instance**: `instance-20260204-215257`
- **Zone**: `us-central1-c`
- **Server path**: `/home/itaikuper/bayles`
- **Process manager**: PM2

`dist/` is committed to git so there's no need to compile on the server.

### First-time setup (WSL)

If `gcloud` is not authenticated yet, run in the WSL terminal:

```bash
gcloud auth login --no-launch-browser
gcloud config set project gen-lang-client-0072875231
```

### Quick access (run a command on the server)

```bash
gcloud compute ssh itaikuper@instance-20260204-215257 --zone=us-central1-c \
  --command='cd ~/bayles && <COMMAND>'
```

### Common server operations

```bash
# Check bot status
gcloud compute ssh itaikuper@instance-20260204-215257 --zone=us-central1-c \
  --command='pm2 status'

# View recent logs
gcloud compute ssh itaikuper@instance-20260204-215257 --zone=us-central1-c \
  --command='pm2 logs bayles --lines 50'

# Deploy: pull latest code and restart
gcloud compute ssh itaikuper@instance-20260204-215257 --zone=us-central1-c \
  --command='cd ~/bayles && git pull && pm2 restart bayles'

# Interactive SSH session
gcloud compute ssh itaikuper@instance-20260204-215257 --zone=us-central1-c
```

## Architecture

**ESM module** (`"type": "module"`) with TypeScript targeting ES2022 / NodeNext. All local imports use `.js` extensions.

### Startup Flow (`src/index.ts`)

1. Validate config → run SQLite migrations → load system prompt from DB
2. Initialize WhatsApp connection (Baileys socket with QR auth)
3. Start services: Scheduler, Birthday, Compaction, BotControl, Calendar (optional)
4. Register message handler, start Express API server
5. Connect multi-tenant WhatsApp pool for business tenants
6. Graceful shutdown handler cleans up all services

### Service Layer (`src/services/`)

- **whatsapp.service.ts** — Baileys socket management, auto-reconnect, message deduplication (10s window), per-JID processing locks to serialize message handling
- **gemini.service.ts** — Gemini AI with function calling. Functions: `create_schedule`, `search_song`, `search_contact`, `list_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`. Manages conversation history and user memory persistence
- **scheduler.service.ts** — `node-cron` wrapper for recurring/one-time scheduled messages with AI content generation and DB persistence
- **birthday.service.ts** — Daily 08:00 check, sends AI-generated greetings
- **calendar.service.ts** — Google Calendar via service account, daily summaries, 5-minute pre-event reminder checks, meeting link extraction (Zoom/Teams/Meet)
- **bot-control.service.ts** — Message decision logic: global enable/disable, per-chat whitelist, time-window scheduling, day-of-week filtering, activity logging
- **compaction.service.ts** — Runs every 2 days at 03:00, summarizes old conversations via Gemini to stay within token limits
- **whatsapp-pool.service.ts** — Multi-tenant support: separate Baileys socket per tenant, independent auth directories, tenant-specific prompts

### Message Handler (`src/handlers/message.handler.ts`)

Routes messages by type: audio → transcription, images → vision AI, documents → extraction, text → bot-control check → Gemini with function calling → response. Special commands: `תמלל` (transcribe quoted voice), `!ai` prefix for direct AI queries.

### Database (`src/database/`)

SQLite via `better-sqlite3` with WAL mode. Migrations in `migrate.ts` auto-run on startup.

- **db.ts** — Connection singleton
- **migrate.ts** — Sequential migration phases (001–010)
- **repositories/** — Repository pattern with 13 repositories (chat-config, bot-settings, activity-log, conversation-history, schedule, birthday, contact, song, knowledge, user-memory, calendar-link, message, tenant)

### API (`src/api/`)

Express v5 REST API. Routes in `src/api/routes/` receive injected service instances. Serves the React dashboard from `web/`.

Routes: groups, messages, scheduler, ai, stats, bot-control, birthdays, knowledge, contacts, songs, calendar, tenants.

### Web Dashboard (`web/`)

Pre-built React 18 app (UMD via CDN, Babel standalone for JSX). RTL Hebrew layout. The `web/app.js` is the compiled bundle — source is inline JSX, not a separate build step.

## Key Patterns

- **All imports use `.js` extensions** even for `.ts` source files (NodeNext module resolution)
- **Singleton services** accessed via `get*()` functions (e.g., `getBotControlService()`, `getWhatsAppPool()`)
- **Per-JID processing locks** in WhatsApp service prevent parallel message handling for the same chat
- **Config** lives in `src/config/env.ts` — loaded from `.env` with defaults, validated at startup
- **Calendar features** are optional — only enabled when `service-account.json` exists
- **Multi-tenant** uses a "default" tenant for the main bot; business tenants get separate WhatsApp sessions and knowledge bases
