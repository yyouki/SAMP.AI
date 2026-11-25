# Repository Instructions

Before changing this project, read [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md), [README.md](README.md), [docs/ROADMAP.md](docs/ROADMAP.md), and the relevant installation/runtime guide. The project-context document is the durable handoff record; update it in the same commit when architecture, implementation state, validation status, or next steps change.

Keep the AI core language-independent. Put runtime-specific native calls in adapters and expose them through schema-validated, explicitly advertised capabilities. Every new adapter action must include payload/result schemas, capability advertisement, authorization boundaries, failure semantics, tests, and documentation.

Treat model output as untrusted. Enforce actor/project permissions and explicit approval in the application before any publishing or destructive action. Adapter authentication is not human authorization. Bind player-specific tasks to the current connection-session ID and logical preview ID. Do not automatically publish a preview edit.

Do not claim the Pawn reference filterscript compiles or works on a live server unless it has been compiled and tested against the exact runtime, compiler, include, and plugin versions. TypeScript CI does not validate Pawn syntax or runtime behavior.

Run `npm run typecheck`, `npm test`, and `npm run build` (or inspect the matching current GitHub Actions run) after changes. Update `docs/ROADMAP.md` and `docs/PROJECT_CONTEXT.md` as part of the feature change.
