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
- **Card editing** — create, edit, duplicate, rename, delete, favourite, and
  swap avatars, across all V2 fields including alternate greetings, the system
  prompt override, post-history instructions and the depth prompt. Import by
  file picker or by dropping PNG / JSON / YAML / CHARX / BYAF onto the library;
  export as PNG or JSON. Edits round-trip a card's `json_data`, so fields this
  app does not model — third-party extension data included — survive a save.
- **Personas** — create from an avatar image, edit, delete, and set a default.
  Names and descriptions are written into the settings file the classic
  interface owns, so both agree on who you are.
- **Chat** — streaming replies, swipes (alternative generations), regenerate,
  inline editing, delete, delete-from-here-down, per-chat drafts.
- **Prompt assembly** — card system prompt, description, personality, scenario,
  persona, example dialogue, history depth, final instruction. The **prompt
  inspector** shows exactly what would be sent, per message, with token
  estimates.
- **Providers** — OpenAI, Anthropic, OpenRouter, Google AI Studio, DeepSeek,
  Mistral, xAI, Cohere, and any OpenAI-compatible endpoint. API keys are written
  to the server's `secrets.json`; they never touch browser storage.
- **OpenAI Responses API** — an opt-in switch routes generations to
  `/v1/responses` instead of `/v1/chat/completions`, for models that want it.
  See [Responses API](#responses-api) below.
- **Reasoning** — reasoning summaries from the Responses API, separately
  streamed reasoning tokens, and inline `<think>` blocks all render as a
  collapsible block.
- **Appearance** — light/dark/system, three densities, sans or serif message
  typeface, message size, and an accent hue slider that drives the whole OKLCH
  palette from one variable.
- **Keyboard** — `⌘K`/`Ctrl+K` command palette, `⌘,` settings, `Enter` to send
  (or `⌘↩`, configurable), `⌘↩` to save an edit, `Esc` to cancel.
- **Responsive** — one layout from 390 px to ultrawide, with safe-area insets.

## Responses API

`/v1/responses` is a different endpoint from Chat Completions, with its own
request shape and its own streaming vocabulary. Turn it on under
**Settings → API** for the OpenAI source, or for a custom endpoint that
implements it. Three things are worth knowing:

- **Nothing is stored.** The API retains responses for 30 days when `store` is
  omitted, so the server always sends `store: false`.
- **Penalties are dropped.** The API has no `frequency_penalty` or
  `presence_penalty`, so those two sliders are not sent while it is on, and the
  UI says so rather than pretending they apply.
- **Rejected parameters self-heal.** Reasoning models refuse `temperature` and
  `top_p`, and which model refuses what keeps changing. Rather than hard-coding
  model families, the server reads the 400 back, drops the parameter it names,
  and retries — so a model released after this code was written still works.

The system prompt is hoisted into `instructions`; a trailing system message
stays in `input` where it is, because in a roleplay prompt a final instruction's
position is the point. Example dialogue keeps its speaker names, which
`instructions` could not carry.

Server side this is `sendOpenAiResponsesRequest` in
`src/endpoints/backends/chat-completions.js` plus `convertResponsesApiMessages`
in `src/prompt-converters.js`, reached by sending `use_responses_api: true`. The
classic UI never sends it, so it keeps using Chat Completions.

## What it does not do yet

The classic UI remains the place for these:

- World info / lorebooks, author's notes, and the prompt manager's ordering.
- Group chats.
- Text completion backends (KoboldAI, TextGen WebUI, NovelAI, Horde).
- Extensions, quick replies, and slash commands.
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

Three layers, all runnable locally.

`npm run next:test` — unit tests for the parts where a bug is silent and
expensive:

- SSE frame splitting across arbitrary chunk boundaries, and delta extraction
  for the OpenAI, Anthropic, Google, Cohere and Responses API stream shapes.
- Macro substitution, including nesting, dice, and self-reference.
- Prompt assembly — role mapping, swipe selection, card overrides, ordering.
- Markdown sanitisation — script tags, event handlers, `javascript:` URLs.
- Chat file parsing and the legacy timestamp format, which both interfaces read.
- Card payload construction — the field mapping the server expects, and the
  `json_data` round trip that stops a save from dropping data.
- Persona settings patching, which rewrites a shared settings file and must
  leave every key it does not own untouched.
- Transport content-type negotiation: a JSON body gets a JSON content type and
  FormData must not, or the multipart boundary is lost and uploads fail.

`npm run test:unit --prefix tests` — the repo's own jest suite, which covers
`convertResponsesApiMessages` alongside the other prompt converters.

`npm run test:e2e --prefix tests` — Playwright smoke tests in
`tests/next-frontend.e2e.js`, against a built bundle and a running server. They
assert the shell boots, deep links resolve, the main surfaces open without a
crash, and switching chats leaves exactly one message list mounted.

One note on verification: run `npm run next:dev` and watch the browser console
at least once before shipping a change. React's duplicate-key and
state-in-effect warnings exist only in development builds — a production bundle
is silent about both, and a duplicate key on two sibling components is how a
leaked message list got shipped once already.

## License

AGPL-3.0, same as the rest of the project.
