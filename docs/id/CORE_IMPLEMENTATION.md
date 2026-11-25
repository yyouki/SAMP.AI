# Implementasi Core

> **Bahasa:** [Indonesia](CORE_IMPLEMENTATION.md) | [English](../CORE_IMPLEMENTATION.md) · [Indeks](INDEX.md)

Core menggunakan TypeScript ESM di Node.js 22+. Ini hanya untuk service layer; adapter server tetap bebas bahasa.

~~~bash
npm install
npm run typecheck
npm test
npm run build
~~~

Source utama: src/core untuk tool registry/executor; src/security untuk execution context/permission; src/protocol untuk gateway; src/adapters untuk registry/queue/Pawn/mock; src/agent untuk agent runner; src/providers untuk model providers; src/extensions untuk skill manager; src/mapping untuk preview orchestration.

Queue, registry, conversation/revision store, mock world, dan approval integration sebagian masih in-memory/interface. Belum ada database, production audit sink, signed approval service, atau runnable backend host lengkap. Lihat [Installation](INSTALLATION.md).
