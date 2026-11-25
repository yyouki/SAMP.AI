# Orkestrasi Mapping Preview Editor

> **Bahasa:** [Indonesia](MAPPING_PREVIEW_EDITOR.md) | [English](../MAPPING_PREVIEW_EDITOR.md) · [Indeks](INDEX.md)

MappingPreviewEditOrchestrator menghubungkan native editor Pawn dengan revisi draft dan approval. Editor tidak langsung membuat objek global.

## Alur

1. Caller memberikan ExecutionContext tepercaya dari autentikasi backend.
2. Core memeriksa mapping.edit dan capability adapter.
3. Core mengantrekan mapping.begin_player_preview_edit dengan preview_id, player_id, player_session_id.
4. Core polling mapping.get_player_preview_edit_result dengan jumlah percobaan dan interval terbatas.
5. Draft revision dibuat hanya saat status completed.
6. Core meminta approval terikat pada hash revisi, server, project, dan tool mapping.apply_draft.
7. Setelah receipt diverifikasi, enqueueApprovedApply mengantrekan mapping.create_object.

## Status

| Status | Tindakan |
|---|---|
| ready / editing | Teruskan polling. |
| completed | Buat revisi dan minta approval. |
| cancelled | Tidak membuat revisi atau approval. |
| not_found | Session/preview tidak cocok; hentikan. |
| timed_out | Batas polling tercapai; tidak apply. |

Default: pollIntervalMs 1000, maxPolls 120, taskTimeoutMs 15000. Setiap polling memakai task tersendiri agar lease tidak ditahan saat pemain memakai GUI.

## Approval dan storage

Apply memerlukan izin mapping.apply dan ApprovalReceipt yang cocok dengan tool ID, hash revisi, server, serta project. Pawn saat ini menolak interior/virtual world selain 0/0 karena CreateObject bersifat global.

InMemoryMappingDraftRevisionStore hanya untuk tes. Produksi membutuhkan revision store persisten dan MappingApprovalRequestPort yang terhubung ke UI approval. Deduplication request berlaku dalam satu proses saja.
