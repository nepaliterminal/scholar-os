# Study Session OS — Website + Browser Extension

An all-in-one study tool (website + browser extension) with **focus/productivity** and **note-taking/highlights** at the core.

## The Gap

The market splits into two camps that almost never talk to each other:

- **Note/highlight tools** — Glasp, Web Highlights, WuCai, Evernote Web Clipper. Great at capturing, but they don't care *when* or *how focused* you were.
- **Focus tools** — StayFocusd, Cold Turkey, Deep Work Zone, Forest-style Pomodoro timers. Great at blocking distractions, but everything you read/highlight during a session vanishes into other apps.

**Opening: a study tool where focus mode and capture are the same thing.**

## Core Loop

1. Start a **study session** (extension popup or website): pick a subject, set a Pomodoro length, optionally block distracting sites.
2. During the session, the extension's **highlighter/clipper is active** — everything you highlight, plus timestamped notes on YouTube lectures and PDFs, is automatically filed under *this session, this subject*.
3. Session ends → the website shows a **session recap**: time focused, pages visited, highlights captured, auto-generated flashcard/quiz drafts from your highlights (spaced-repetition queue for later).
4. Over time: per-subject analytics — "you focus best 9–11am", "Biology notes are 80% from 3 sources", streaks, review-due reminders.

## Why It Beats Incumbents

- Glasp/Web Highlights capture but have no session/focus context; Forest/Cold Turkey block but capture nothing. Linking "what I learned" to "when and how I studied" is data none of them have.
- The recap + auto-flashcards turn passive highlighting into active recall — the thing students actually need at exam time.
- Differentiators that are cheap to build:
  - YouTube timestamp notes (proven demand: MensorAI, YiNote)
  - **Clickbait thumbnail hider** — blur/hide YouTube thumbnails and sensational titles so you pick videos by intent, not by bait. Modes: blur-all, hide-all (show channel + duration only), or whitelist educational channels/playlists. Optionally also collapse "Up next" autoplay suggestions and Shorts shelves during study sessions.
  - PDF highlighting
  - Distraction-block log tied to sessions ("tried to open Twitter 4 times at 10pm")

## Two-App Split: Scholar OS Plans, Extension Studies

- **Scholar OS** (`~/notion1/scholar-os/index.html`) = the planner: schedule, homework, habits, stars & rewards, parent reports (Poke). Self-contained, localStorage-based.
- **The extension** = the study helper: focus sessions, blocking, clickbait shield, highlight/note capture while actually studying.
- **Stars are the shared currency** — the extension earns them (clean sessions, finished homework), Scholar OS's reward shop spends them.
- **Bridge:** extension content script talks to a small `window.ScholarOS` API on the dashboard page (log session, add stars, add note). No backend needed.

## Recommended Features (top 3 picks)

1. **Brain-dump warm-up** — first 60 seconds of each session: "what do you remember from last time on this subject?" typed from memory before any notes are shown. Retrieval practice built into the ritual — turns the extension into actual pedagogy, not just a blocker.
2. **Unblock requests** — kid hits a blocked site they genuinely need → "Request access" with a reason box → parent approves from Scholar OS. Solves the #1 blocker frustration in a way that involves parents positively.
3. **Session intention + self-rating** — before starting: one line, "what will you finish?" At the end: done / mostly / not really. Cheap to build, builds estimation/reflection habits, and generates the reflection data no competitor has.

## MVP Scope (don't build everything)

- **Extension (MV3, plain TS or React):** session start/stop, site blocker, text highlight + note, sync to backend.
- **Website (Next.js + Postgres/Supabase):** session history, notes browser by subject, simple review queue.
- **Defer:** AI flashcards, mobile app, social features, PDF support.

## Monetization (later)

- **Free:** highlighting + basic sessions.
- **Paid:** unlimited blocked-site lists, AI summaries/flashcards, advanced analytics.

## References

- [5 Best Chrome Extensions for Note-Taking — MensorAI](https://www.mensorai.com/blog/best-chrome-extensions-youtube-note-taking)
- [2025: The Web Highlighting Tools You Shouldn't Miss — WuCai](https://blog.wucainote.com/articles/2025-the-web-highlighting-tools-you-shouldnt-miss.html)
- [Best Website Blocker Chrome Extensions in 2025 — Deep Work Zone](https://deepworkz.one/learn/best-website-blocker-chrome-extensions-in-2025-(free-paid))
- [Best Pomodoro Timer Apps of 2025 — Tivazo](https://tivazo.com/best-pomodoro-timer-apps/)
