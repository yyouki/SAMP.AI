# Mock Game Adapter

> **Bahasa:** [Indonesia](MOCK_GAME_ADAPTER.md) | [English](../MOCK_GAME_ADAPTER.md) · [Indeks](INDEX.md)

Mock Game Adapter adalah runtime in-memory untuk menguji adapter contract tanpa server SA-MP/open.mp. Ia memakai AdapterActionRegistry dan AdapterTaskQueue yang sama.

Mock mensimulasikan player state/session, private preview, editor ready → editing → completed/cancelled, anchor, marker, mapping object, native-world removal directive simulasi, idempotency, dan injected failure.

Mock tidak memanggil Pawn native atau membuka GUI game. finishPlayerPreviewEdit menyimulasikan callback editor; final mengubah transform preview pribadi, cancel mempertahankan transform sebelumnya. Disconnect/session replacement menghapus preview. Semua state hilang saat restart; mock bukan runtime produksi.

Jalankan npm test untuk menjalankan seluruh suite.
