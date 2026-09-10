# SillyTavern Next — modern frontend

A ground-up rewrite of the SillyTavern chat interface, served alongside the
classic UI. The existing interface at `/` is untouched; this one lives at
`/next` and talks to the same backend over the same REST API.

## Why a second frontend

The classic UI is a 734 KB `index.html`, a 12,500-line `script.js`, and ~2.7 MB
of jQuery, jQuery UI, select2, toastr, moment and Popper. It works, and a great
deal of behaviour is encoded in it, so replacing it in place is not realistic.

This app takes the [strangler fig][strangler] route instead: a new frontend that
uses the server as-is, shares the same data on disk, and can grow feature by
feature while the old interface keeps running. Both read and write the same
character cards and `.jsonl` chat files, so you can switch between them mid-chat.

[strangler]: https://martinfowler.com/bliki/StranglerFigApplication.html

## Running it

```bash
npm run next:install   # once
npm run next:build
npm start              # then open http://localhost:8000/next
```

For frontend development, run the Vite dev server against a running SillyTavern:

```bash
npm start              # terminal 1 — the backend on :8000
npm run next:dev       # terminal 2 — HMR on :5173/next/
```

`ST_BACKEND` overrides the proxy target if your server is not on
`http://127.0.0.1:8000`.

```bash
npm run next:test      # unit tests
```

If `/next` is opened before the app has been built, the server answers with the
build instructions rather than a 404.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Build | Vite 8 (Rolldown) | ~1s production builds, native ESM dev server |
| UI | React 19 + TypeScript (strict) | `ref` as a prop, no `forwardRef` ceremony |
| Styling | Tailwind CSS v4 | CSS-first `@theme`, runtime-swappable tokens |
| Server state | TanStack Query v5 | one cache for chats, characters, models |
| Client state | Zustand v5 + `persist` | settings and appearance survive reloads |
| Routing | React Router v7 | deep-linkable chats |
| Primitives | Radix UI | focus traps and ARIA that are easy to get wrong |
| Markdown | marked + DOMPurify | model output is untrusted input |
| Tests | Vitest | 97 tests over the logic that is worth testing |

No jQuery, no moment, no Font Awesome. The production bundle is ~195 KB gzipped
in three long-lived chunks, plus 9 KB of CSS.

## What it does today

- **Character library** — grid and sidebar, fuzzy search across name, tags,
  creator and description, sorting, favourites.
- **Chat** — streaming replies, swipes (alternative generations), regenerate,
  inline editing, delete, delete-from-here-down, per-chat drafts.
- **Prompt assembly** — card system prompt, description, personality, scenario,
  persona, example dialogue, history depth, final instruction. The **prompt
  inspector** shows exactly what would be sent, per message, with token
  estimates.
- **Providers** — OpenAI, Anthropic, OpenRouter, Google AI Studio, DeepSeek,
  Mistral, xAI, Cohere, and any OpenAI-compatible endpoint. API keys are written
  to the server's `secrets.json`; they never touch browser storage.
- **Reasoning** — separately streamed reasoning tokens and inline `<think>`
  blocks both render as a collapsible block.
- **Appearance** — light/dark/system, three densities, sans or serif message
  typeface, message size, and an accent hue slider that drives the whole OKLCH
  palette from one variable.
- **Keyboard** — `⌘K`/`Ctrl+K` command palette, `⌘,` settings, `Enter` to send
  (or `⌘↩`, configurable), `⌘↩` to save an edit, `Esc` to cancel.
- **Responsive** — one layout from 390 px to ultrawide, with safe-area insets.

## What it does not do yet

The classic UI remains the place for these:

- World info / lorebooks, author's notes, and the prompt manager's ordering.
- Group chats.
- Text completion backends (KoboldAI, TextGen WebUI, NovelAI, Horde).
- Extensions, quick replies, and slash commands.
- Character and persona creation, import and editing.
- Instruct-mode templates and context templates.

Two interop notes: this app does not update a card's "current chat" pointer, so
the classic UI may open a different chat file for the same character; and chats
started here appear in the classic UI's chat list as normal.

## Layout

```
public-next/
├── src/
│   ├── api/          typed transport + resource modules + query hooks
│   ├── components/   app shell, palette, error boundary, design system
│   ├── features/     characters, chat, settings — each self-contained
│   ├── lib/          pure helpers: markdown, macros, SSE, search, format
│   ├── store/        zustand stores (ui, session)
│   └── styles/       design tokens and base styles
└── vite.config.ts
```

The rule that keeps this navigable: `lib/` is pure and testable, `api/` is the
only place that talks to the network, `features/` composes both, and
`components/ui/` knows nothing about SillyTavern.

Server-side, the whole integration is one file: `src/next-frontend.js`, mounted
from `src/server-main.js`.

## Testing

`npm run next:test` covers the parts where a bug is silent and expensive:

- SSE frame splitting across arbitrary chunk boundaries, and delta extraction
  for the OpenAI, Anthropic, Google and Cohere stream shapes.
- Macro substitution, including nesting, dice, and self-reference.
- Prompt assembly — role mapping, swipe selection, card overrides, ordering.
- Markdown sanitisation — script tags, event handlers, `javascript:` URLs.
- Chat file parsing and the legacy timestamp format, which both interfaces read.

## License

AGPL-3.0, same as the rest of the project.
