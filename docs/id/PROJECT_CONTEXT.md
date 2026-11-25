# Konteks Proyek dan Catatan Handoff

> **Bahasa:** [Indonesia](PROJECT_CONTEXT.md) | [English](../PROJECT_CONTEXT.md) · [Indeks](INDEX.md)

Dokumen ini adalah memori teknis permanen di repository. Baca sebelum mengubah arsitektur agar pengembangan tidak hanya mengandalkan riwayat chat.

## Repository dan file penting

- URL: https://github.com/yyouki/samp-ai
- Branch: main; TypeScript ESM; Node.js 22+.
- src/adapters/adapter-action-registry.ts — action/schema.
- src/adapters/adapter-task-queue.ts — queue/lease/idempotency.
- src/protocol/http-adapter-gateway.ts — endpoint adapter.
- adapters/pawn/samp_ai_adapter.pwn — reference filterscript.
- src/mapping/preview-edit-orchestrator.ts — edit, revision, approval.
- docs/PROJECT_CONTEXT.md — versi English catatan ini.

## Enam action Pawn

1. context.get_player_state.
2. mapping.create_object — CreateObject global, context permintaan 0/0.
3. mapping.preview_player_object.
4. mapping.clear_player_preview.
5. mapping.begin_player_preview_edit.
6. mapping.get_player_preview_edit_result.

Preview/editor state in-memory. Session baru, disconnect, re-preview, atau filterscript unload membuang state lama. Status completed adalah kandidat revisi draft, bukan approval.

## CI dan release

.github/workflows/ci.yml menjalankan TypeScript check/test/build dan Pawn compile untuk target SA-MP/open.mp. scripts/build-pawn.sh mematok versi compiler/include. Tag v* memicu GitHub Release setelah job validasi sukses.

Release berisi dist, source/config Pawn, schema, docs, dua file AMX, build-info, dan checksum. Ini reference bundle, bukan backend/dashboard lengkap.

## Invariant

1. Model output tidak tepercaya; validasi schema, identifier, numeric range, capability, dan jumlah operasi.
2. Adapter authentication adalah identitas mesin, bukan identitas admin.
3. Preview edit tidak otomatis publish.
4. Task player harus terikat pada player_session_id dan preview_id aktif.
5. CreateObject bersifat global.
6. Jangan retry operasi non-idempotent dengan outcome tidak diketahui sebelum memeriksa server.
7. Jangan mengklaim native world removal memiliki exact undo.
8. Jangan jalankan kode Pawn/C++/shell/database yang dibuat model.

## Keterbatasan dan langkah berikutnya

Queue, registry, revision store, preview state masih in-memory. Belum ada backend host lengkap, dashboard, production auth, database, signed approval service, atau installer.

Langkah berikut: pastikan Pawn compile hijau dan live-test; buat backend host/admin UI; ganti storage dengan database; tambah signed approvals/audit/object inventory; lanjutkan catalog, batch, revision, undo/restore.
