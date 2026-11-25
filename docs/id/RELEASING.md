# Build dan GitHub Release

> **Bahasa:** [Indonesia](RELEASING.md) | [English](../RELEASING.md) · [Indeks](INDEX.md)

Workflow .github/workflows/ci.yml menggabungkan validasi TypeScript, kompilasi Pawn, dan publikasi GitHub Release.

## CI pada push dan pull request

Setiap push ke main, pull request, dan workflow_dispatch menjalankan dua job validasi:

1. Node.js 22 memasang dependency, memeriksa tipe source/test, menjalankan tes, dan membangun output TypeScript ke dist/.
2. scripts/build-pawn.sh mengunduh compiler serta include yang versinya dipatok, lalu mengompilasi filterscript untuk SA-MP dan open.mp.

Run yang berhasil mengunggah samp-ai-dist dan samp-ai-pawn-build sebagai workflow artifacts sementara. Jika salah satu job validasi gagal, release tidak diterbitkan.

## Apa isi samp-ai-dist?

Artifact samp-ai-dist hanya berisi folder dist/ hasil kompilasi: modul JavaScript, deklarasi tipe TypeScript (.d.ts), dan source map. Hasil ini dapat dipakai aplikasi lain untuk mengimpor core SAMP.AI tanpa mengompilasi TypeScript lagi. Ini bukan server mandiri atau installer dan tidak menyertakan node_modules. Gunakan Node.js 22+ dan pasang runtime dependency yang tercantum di package.json.

Artifact ini bersifat sementara dan disimpan selama 14 hari. Untuk integrasi, paket release lengkap samp-ai-vX.Y.Z.zip lebih cocok diunduh karena juga berisi source/config Pawn, file .amx hasil compile SA-MP dan open.mp, schemas, dokumentasi, serta metadata build.

## Terbitkan versi

Untuk rilis biasa, buat dan push tag versi yang sama dengan versi di package.json:

~~~bash
git checkout main
git pull --ff-only
git tag vX.Y.Z
git push origin vX.Y.Z
~~~

Untuk menerbitkan release langsung dari main melalui otomatisasi, gunakan pesan commit lengkap dengan format persis release: vX.Y.Z. Workflow memeriksa kecocokan versi dengan package.json, menjalankan kedua job validasi, lalu membuat tag dan GitHub Release pada commit tersebut.

Job publish-release hanya berjalan setelah validate dan build-pawn berhasil.

## Aset release

- samp-ai-vX.Y.Z.zip dan .tar.gz: reference bundle dengan TypeScript dist/, source/config Pawn, schemas, dan dokumentasi.
- File samp_ai_adapter.amx terpisah untuk SA-MP dan open.mp.
- build-info.txt berisi asal compiler dan include.
- Checksum .sha256 untuk arsip.

Workflow artifacts biasa bersifat sementara dan kedaluwarsa sesuai masa retensinya. Aset GitHub Release tetap terlampir pada versi yang diterbitkan.

Paket ini adalah reference integration bundle, bukan aplikasi backend lengkap atau installer satu klik. Paket tidak menyertakan secret server, binary plugin pihak ketiga, database persisten, dashboard admin, atau approval service produksi. Compile yang berhasil bukan bukti bahwa filterscript sudah diuji langsung di server game. Tentukan lisensi proyek dan tinjau lisensi dependency pihak ketiga sebelum distribusi produksi.
