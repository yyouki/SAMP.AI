# HTTP Adapter Gateway

> **Bahasa:** [Indonesia](ADAPTER_GATEWAY.md) | [English](../ADAPTER_GATEWAY.md) · [Indeks](INDEX.md)

Gateway adalah transport machine-to-machine untuk registrasi adapter, heartbeat, dan task bertipe yang telah didaftarkan. Ini bukan public player API dan tidak menerima kode arbitrer.

## Endpoint

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | /health | Tidak | Health check. |
| POST | /v1/adapters/hello | Bearer | Registrasi adapter. |
| POST | /v1/adapters/heartbeat | Bearer | Heartbeat. |
| GET | /v1/adapters/me | Bearer | Membaca adapter aktif. |
| DELETE | /v1/adapters/me | Bearer | Disconnect. |
| GET | /v1/adapters/tasks/next | Bearer | Claim task dan lease. |
| POST | /v1/adapters/tasks/{taskId}/renew | Bearer + lease | Renew lease. |
| POST | /v1/adapters/tasks/{taskId}/result | Bearer + lease | Kirim hasil tervalidasi. |

Credential dipetakan server-side ke satu adapterId dan serverInstanceId.

## Siklus task

Core mendaftarkan action dan schema. Orchestrator memeriksa permission/autonomy/approval; queue memeriksa capability dan payload; adapter mengeksekusi native allowlisted; hasil dikirim dan divalidasi. Lease non-idempotent yang kedaluwarsa menjadi TASK_OUTCOME_UNKNOWN, tidak diulang otomatis.

Heartbeat default sekitar 15 detik; adapter dianggap stale setelah 60 detik. Queue dan registry masih in-memory. Gateway harus berada di belakang HTTPS reverse proxy atau TLS transport lain. In-memory bearer authenticator hanya untuk development. Belum ada database, public admin enqueue API, built-in TLS, rate limiting, atau credential service produksi.
