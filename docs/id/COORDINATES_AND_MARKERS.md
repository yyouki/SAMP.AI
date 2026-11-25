# Workflow Koordinat dan Marker

> **Bahasa:** [Indonesia](COORDINATES_AND_MARKERS.md) | [English](../COORDINATES_AND_MARKERS.md) · [Indeks](INDEX.md)

AI tidak boleh mengarang koordinat presisi dari teks. Setiap koordinat memerlukan reference frame, interior/virtual-world context, sumber, serta confidence/precision.

Prioritas sumber: titik yang dipilih user berwenang; surface hit/raycast editor; posisi/facing pemain yang dilabeli estimasi; koordinat eksplisit user; terakhir proposal AI yang perlu konfirmasi.

Marker dapat menandai anchor, posisi draft, native-object candidate, batas, dan jalur. Marker harus memiliki ID/project scope dan dibersihkan setelah review.

Jangan mencampur koordinat antar interior/virtual world. Validasi finite numbers, numeric range, model ID, jarak, jumlah marker/object, duplikasi, dan capability adapter. Marker bukan bukti object dapat diletakkan tepat di permukaan.
