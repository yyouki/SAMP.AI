# Model Providers

> **Bahasa:** [Indonesia](PROVIDERS.md) | [English](../PROVIDERS.md) · [Indeks](INDEX.md)

Core menyediakan interface provider-neutral sehingga model cloud dan lokal dapat ditambahkan tanpa mengubah Pawn adapter atau tool contracts.

Repository memiliki provider opsional OpenAI Responses API. API key harus disimpan sebagai backend secret; jangan letakkan di Pawn script, game client, atau repository publik.

Provider memetakan pesan/response ke agent contract, mendukung structured tool call, menghormati timeout/cancellation, menangani error tanpa membocorkan key, dan menghitung usage/cost jika budget tersedia. Endpoint eksternal harus memakai HTTPS; HTTP hanya untuk loopback development.
