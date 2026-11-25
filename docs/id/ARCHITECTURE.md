# Arsitektur SAMP.AI

> **Bahasa:** [Indonesia](ARCHITECTURE.md) | [English](../ARCHITECTURE.md) · [Indeks](INDEX.md)

Dokumen ini menjelaskan target arsitektur, bukan klaim bahwa seluruh komponen sudah tersedia.

Core tidak bergantung pada Pawn. Adapter membaca context tepercaya, mengiklankan capability, dan menjalankan operation yang tervalidasi. Model output tidak tepercaya; schema validator, permission engine, dan approval workflow menjadi batas sebelum execution. Model call dan planning berada di luar game-server tick; mutasi melalui queue/batch terbatas.

Komponen: AI core, bounded agent runtime, model provider interface, project memory, skill/tool registry, permission/approval engine, protocol gateway, game adapter, extension manager, dashboard/in-game UI.

Core awal menggunakan TypeScript/Node.js 22+. Sudah tersedia schema validation, tool registry, permission/autonomy checks, agent runner, provider opsional, adapter registry, mock adapter, dan HTTP gateway.

Target deployment adalah satu AI service dengan satu adapter per server melalui JSON/HTTP. Queue, registry, revision store belum persisten dan backend/dashboard host belum siap pakai.
