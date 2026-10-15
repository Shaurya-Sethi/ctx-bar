- this repo implements `ctx-bar`: a Claude Code plugin displaying context-window usage as a stacked bar above the prompt.

- discover repo structure dynamically with cli search tools.
- use the Claude Code host's TypeScript/TSX tooling and `claude-code/testing` harness for build, test, and lint; confirm available commands from host documentation.
  - `tsconfig.json` extends host-provided `.claude-plugin/types/tsconfig.json`, absent from this checkout; obtain the host tooling before typechecking.
- follow conventional TypeScript style and the existing single-quote, semicolon-free formatting.
- treat documentation as part of the code: add or update concise inline docs for modules and significant items, explaining purpose, invariants, side effects, and errors without restating signatures.

- minimize software-entropy by designing with intent.
- favor deep modules: relatively few, large modules with simple interfaces that hide complexity, rather than shallow modules with complex, fragmented interfaces.
- codebase should be easy to change and testable.

- follow pragmatic test driven development
  - be mindful of the tests you write. do not write useless tests for the sake of coverage.
- always read documentation before changing code or implementing anything new.
  - official upstream docs — use web search or browse local source.
  - current repo code, tests, public interfaces.
  - repo domain artifacts (`GLOSSARY.md`, relevant ADRs in `docs/adr/`) when present.
- before exploring code, read `docs/agents/domain.md` for single-context glossary and ADR consumer rules.

- preserve host integration: refresh from locally estimated summary usage for the main session, retain other AbovePrompt renderers, and persist the visibility preference through the host store.

- issues are tracked in `GitHub Issues` for `Shaurya-Sethi/ctx-bar`.
  - For ticket operations, read `docs/agents/issue-tracker.md`.
