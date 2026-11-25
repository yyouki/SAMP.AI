# Native GTA World Objects dan Undo/Redo

> **Bahasa:** [Indonesia](NATIVE_WORLD_OBJECTS.md) | [English](../NATIVE_WORLD_OBJECTS.md) · [Indeks](INDEX.md)

Objek bawaan GTA berbeda dari object yang dibuat server. Native RemoveBuildingForPlayer bekerja pada scope pemain, bukan delete untuk CreateObject.

Catat player_id, session_id, model ID, posisi/radius, directive ID. Jangan klaim removal global bila native hanya bekerja pada seorang pemain. Simpan riwayat directive agar reconnect tidak mengulang operasi. Validasi radius, model ID, koordinat, dan jumlah operasi.

Native removal tidak menyediakan pasangan restore yang memulihkan objek bawaan secara instan dan tepat. Recovery dapat memerlukan reconnect tanpa mengulang directive atau object pengganti yang dilabeli jelas. Jangan menjanjikan exact undo. Mock hanya mencatat directive simulasi.
