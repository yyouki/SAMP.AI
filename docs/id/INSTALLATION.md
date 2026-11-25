# Panduan Instalasi SA-MP dan open.mp

> **Bahasa:** [Indonesia](INSTALLATION.md) | [English](../INSTALLATION.md) · [Indeks](INDEX.md)

**Status:** SAMP.AI belum berupa satu plugin .dll/.so atau aplikasi siap produksi. Panduan ini menjelaskan build Pawn melalui GitHub Actions dan pemasangan reference filterscript. Backend masih memerlukan host application yang menghubungkan gateway, queue, autentikasi, dan approval.

## Komponen

1. **Backend Node.js:** adapter registry, task queue, authenticated HTTP gateway. Repository menyediakan library core, bukan host application lengkap.
2. **Pawn filterscript:** berjalan pada SA-MP/open.mp dan berkomunikasi melalui HTTPS.
3. **HTTPS transport:** dependency eksternal https_samp.
4. **JSON parser:** json_parser.inc dari pawn-json-parser.

Periksa lisensi dependency: [https_samp](https://github.com/NullSablex/https_samp/releases) dan [pawn-json-parser](https://github.com/NimaBastani/pawn-json-parser).

## 1. Build TypeScript

~~~bash
git clone https://github.com/yyouki/samp-ai.git
cd samp-ai
npm install
npm run typecheck
npm test
npm run build
~~~

Ini membangun library TypeScript, bukan menjalankan AI server lengkap. Belum tersedia npm start, dashboard admin, public task enqueue API, atau database persisten.

## 2. Ambil Pawn build dari GitHub Actions

Buka tab Actions pada repository, pilih workflow CI and Release terbaru, pastikan job TypeScript dan Pawn sukses, lalu unduh artifact samp-ai-pawn-build.

~~~text
samp/samp_ai_adapter.amx
openmp/samp_ai_adapter.amx
build-info.txt
~~~

Artifact Actions bersifat sementara sesuai masa retensinya. GitHub Release digunakan untuk distribusi versi. Lihat [Build dan Release](RELEASING.md).

## 3. Build Pawn manual

~~~bash
bash scripts/build-pawn.sh ./artifacts/pawn
~~~

Script mengunduh compiler dan standard include dengan versi/commit yang dipatok. Output berada di artifacts/pawn/samp/ dan artifacts/pawn/openmp/. Build manual dirancang untuk Linux.

## 4. Pasang dependency

Salin https_samp.inc dan json_parser.inc ke direktori include compiler. Untuk SA-MP, binary https_samp.dll/.so berada di plugins/. Untuk open.mp native component, binary berada di components/; alternatifnya gunakan legacy plugin di plugins/ dan daftarkan pawn.legacy_plugins. Jangan memuat binary yang sama dengan kedua mode sekaligus.

## 5. Konfigurasi token

Salin adapters/pawn/samp_ai_adapter.example.json ke scriptfiles/samp_ai_adapter.json.

~~~json
{
  "gateway_base_url": "https://domain-backend.example",
  "adapter_token": "GANTI_DENGAN_TOKEN_UNIK",
  "server_instance_id": "server-utama",
  "adapter_id": "sampai-pawn",
  "runtime": "open.mp",
  "server_clock_is_utc": true
}
~~~

Gunakan runtime samp untuk SA-MP dan open.mp untuk open.mp. Token harus cocok dengan credential backend untuk adapter_id dan server_instance_id. Timestamp memakai UTC Z; sinkronkan jam host ke UTC. Jangan commit token asli.

## 6. Muat di SA-MP

Letakkan AMX di filterscripts/samp_ai_adapter.amx, binary di plugins/, konfigurasi di scriptfiles/. Tambahkan ke server.cfg:

~~~text
plugins https_samp
filterscripts samp_ai_adapter
~~~

Sesuaikan nama plugin dengan platform, misalnya https_samp.dll untuk Windows atau https_samp.so untuk Linux.

## 7. Muat di open.mp

Letakkan AMX di filterscripts/. Mode native component: pasang binary di components/ dan tambahkan ke config.json:

~~~json
{
  "pawn": {
    "side_scripts": ["filterscripts/samp_ai_adapter"]
  }
}
~~~

Mode legacy plugin: pasang binary di plugins/ dan gabungkan konfigurasi:

~~~json
{
  "pawn": {
    "legacy_plugins": ["https_samp"],
    "side_scripts": ["filterscripts/samp_ai_adapter"]
  }
}
~~~

Gabungkan konfigurasi dengan config.json yang ada. Lihat [open.mp config.json](https://open.mp/docs/server/config.json).

## Batas implementasi

mapping.create_object memakai CreateObject global. Preview memakai CreatePlayerObject dan hanya terlihat oleh pemain target. Queue, registry, dan preview/editor state masih in-memory. Belum ada admin dashboard atau approval UI siap pakai. CI compile bukan live test server.

Lihat [Pawn Adapter](PAWN_ADAPTER.md), [Build/Release](RELEASING.md), dan [Preview Editor](MAPPING_PREVIEW_EDITOR.md).
