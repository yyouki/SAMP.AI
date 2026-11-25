# Roadmap SAMP.AI

> **Bahasa:** [Indonesia](ROADMAP.md) | [English](../ROADMAP.md) · [Indeks](INDEX.md)

Roadmap mengutamakan satu jalur end-to-end yang aman dan dapat diuji.

## Fase 0 — Fondasi

- [x] Ringkasan proyek dan dokumen desain.
- [x] TypeScript/Node.js 22+ untuk core.
- [ ] Lisensi, contribution guide, code of conduct, security reporting.

## Fase 1 — Protokol dan test harness

- [x] Schema protokol, handshake adapter, koordinat.
- [x] Type-check, unit tests, TypeScript build.
- [x] Adapter registry, authenticated HTTP gateway, action registry, in-memory task queue.
- [x] Mock Game Adapter dan kontrak action Pawn.
- [x] CI untuk kompilasi Pawn SA-MP dan open.mp menggunakan toolchain yang dipatok.
- [x] Workflow tag versi untuk GitHub Release setelah semua job validasi sukses.
- [ ] Durable task storage, worker dedupe, conformance test lintas adapter.

## Fase 2 — AI Core

- [x] Agent loop provider-neutral dan OpenAI Responses API provider opsional.
- [x] Tool registry, permission/autonomy gate, approval verifier interface.
- [ ] Provider alternatif, conversation store persisten, signed approval, audit storage, token/cost budget.

## Fase 3 — Adapter Pawn

- [x] Task polling, heartbeat, result submission terautentikasi.
- [x] Player state, global object create terbatas, private preview, native editor, cleanup session.
- [ ] Live test pada server SA-MP dan open.mp.
- [ ] Durable queue/operation storage, bounded object queue, native-world directive.

## Fase 4 — Mapping MVP

- [x] Private preview per player dan editor.
- [x] Orkestrasi edit, draft revision, approval gate.
- [ ] Object catalog, anchor-relative layout, grid snapping, object groups, undo/restore.

## Fase 5–8

- [ ] TextDraw MVP, project memory, adapter C++/TypeScript/Rust, conformance suite, dashboard, extension manager.

Fitur selesai bila schema/protokol, authorization, capability/fallback, failure tests, dokumentasi pengguna, serta preview/audit mutasi tersedia.
