# Universal Protocol

> **Bahasa:** [Indonesia](PROTOCOL.md) | [English](../PROTOCOL.md) · [Indeks](INDEX.md)

Protokol SAMP.AI memisahkan AI core dari runtime game. Adapter mengirim handshake, heartbeat, dan task result melalui JSON envelope berversi. Identitas adapter/server ditentukan autentikasi, bukan klaim di payload.

Pesan memiliki schema; capability dinegosiasikan pada adapter.hello. Setiap action memiliki ID, payload/result schema, risk, effect, idempotency, dan compensation. Mutasi berjalan melalui task queue dan lease token.

Result memakai status succeeded, partially_succeeded, atau failed. Result sukses harus sesuai schema; result gagal wajib memiliki error.code dan error.message. Schema berada di schemas/protocol/.
