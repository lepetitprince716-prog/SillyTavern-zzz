# SillyTavern

LLM Frontend for Power Users

## Modern frontend (preview)

This fork ships a second, ground-up frontend built with React 19, TypeScript,
Vite and Tailwind CSS v4. It runs alongside the classic interface and shares the
same characters and chat files. It adds opt-in support for the OpenAI Responses
API (`/v1/responses`) and a rebuilt world info engine that explains every
activation, ranks the token budget by relevance, and can match lore by meaning
as well as by keyword.

```bash
npm run next:install
npm run next:build
npm start   # classic UI at /, the new one at /next
```

See [`public-next/README.md`](public-next/README.md) for the architecture, what
it covers so far, and what still belongs in the classic interface.

## Resources

- GitHub: <https://github.com/SillyTavern/SillyTavern>
- Docs: <https://docs.sillytavern.app/>
- Discord: <https://discord.gg/sillytavern>
- Reddit: <https://reddit.com/r/SillyTavernAI>

## License

AGPL-3.0
