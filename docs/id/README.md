# SAMP.AI

> **Bahasa:** [Indonesia](README.md) | [English](../../README.md) · [Indeks dokumentasi](INDEX.md) · [Pilihan bahasa](LANGUAGES.md)

SAMP.AI adalah proyek open-source untuk membantu pengembangan server SA-MP dan open.mp melalui AI. Fokus awalnya adalah mapping, preview objek, koordinat, TextDraw, dan workflow server yang dapat diperluas melalui adapter dan skill.

**Status: early core scaffold.** Repository memiliki TypeScript core, schema protokol, adapter registry, task queue, Mock Game Adapter, Pawn reference filterscript, serta orkestrasi preview editor dan approval.

Proyek ini belum menjadi aplikasi AI lengkap yang siap dijalankan. Backend host, dashboard admin, autentikasi produksi, database persisten, dan approval service produksi belum tersedia. Pawn filterscript masih perlu dikompilasi dan diuji pada server target.

## Komponen saat ini

- **TypeScript core:** tool registry, schema validation, agent runner, permission/autonomy gate, dan abstraksi provider.
- **Adapter gateway:** registrasi, heartbeat, task polling, lease, dan result validation.
- **Mock Game Adapter:** simulasi player state, preview, editor, mapping object, anchor, dan marker.
- **Pawn reference adapter:** membaca player state, membuat global object terbatas, private preview, dan native editor.
- **Preview orchestration:** polling bounded, draft revision setelah edit selesai, approval terpisah sebelum apply.
- **GitHub Actions:** TypeScript validation, build Pawn untuk dua target, workflow artifacts, serta GitHub Release berbasis tag.

## Panduan utama

- [Instalasi](INSTALLATION.md)
- [Pawn Adapter](PAWN_ADAPTER.md)
- [Build dan GitHub Release](RELEASING.md)
- [Preview Editor](MAPPING_PREVIEW_EDITOR.md)
- [Roadmap](ROADMAP.md)
- [Project Context](PROJECT_CONTEXT.md)

Core tidak bergantung pada Pawn. Adapter mengiklankan capability yang tersedia; core hanya mengirim action yang tervalidasi, didukung, dan diizinkan.

Model output adalah input tidak tepercaya. Validasi schema, model ID, koordinat, capability, permission actor, dan approval untuk revisi yang tepat sebelum mutasi server. Preview edit bukan persetujuan publikasi.

Lihat [indeks dokumentasi Indonesia](INDEX.md) dan [English index](../INDEX.md).
