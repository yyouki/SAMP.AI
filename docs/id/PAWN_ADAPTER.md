# Pawn Adapter — Integrasi Referensi

> **Bahasa:** [Indonesia](PAWN_ADAPTER.md) | [English](../PAWN_ADAPTER.md) · [Indeks](INDEX.md)

Statusnya reference filterscript. Kontrak TypeScript dicakup CI; Pawn source harus berhasil dikompilasi dan tetap memerlukan live test pada server.

## Enam action

| Action | Fungsi |
|---|---|
| context.get_player_state | Membaca posisi, facing, interior, virtual world, session ID. |
| mapping.create_object | Membuat CreateObject global; permintaan dibatasi context 0/0. |
| mapping.preview_player_object | Membuat/mengganti private CreatePlayerObject preview. |
| mapping.clear_player_preview | Menghapus preview jika player/session/preview ID cocok. |
| mapping.begin_player_preview_edit | Membuka native editor pada preview yang cocok. |
| mapping.get_player_preview_edit_result | Membaca status editor dan transform terakhir. |

Adapter tidak mengiklankan marker, TextDraw, mapping update/delete, native-world removal, atau arbitrary code execution.

## Dependency

- https_samp v1.0.0: HTTPS transport dan Bearer header.
- pawn-json-parser: JSON parser murni Pawn.
- Compiler dan standard include sesuai target.

Untuk open.mp, https_samp dapat dimuat sebagai native component atau legacy plugin. Untuk SA-MP, muat sebagai plugin. Tinjau lisensi dependency sebelum distribusi.

## Build otomatis

CI menjalankan scripts/build-pawn.sh dengan compiler dan commit include yang dipatok. Output:
- samp/samp_ai_adapter.amx
- openmp/samp_ai_adapter.amx
- build-info.txt

Build sukses bukan bukti filterscript sudah live-tested.

## Siklus preview

1. Panggil context.get_player_state dan ambil session_id terbaru.
2. Buat preview dengan mapping.preview_player_object.
3. Mulai editor dengan mapping.begin_player_preview_edit.
4. Baca hasil dengan mapping.get_player_preview_edit_result.
5. Hanya status completed menjadi kandidat revisi draft.
6. cancelled atau not_found menghentikan alur tanpa apply.
7. Setelah draft divalidasi dan approval diberikan, core dapat mengantrekan apply.
8. Bersihkan preview dengan mapping.clear_player_preview.

Jangan langsung mengantrekan mapping.create_object setelah status completed. Hasil tersebut adalah draft, bukan approval.

Semua task player harus cocok dengan player_session_id dan preview_id aktif. Satu preview aktif dilacak per pemain; state bersifat sementara. Jika hasil HTTP mutation tidak pasti, adapter berhenti memproses task baru. Jangan commit token.
