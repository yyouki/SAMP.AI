# Build dan GitHub Release

> **Bahasa:** [Indonesia](RELEASING.md) | [English](../RELEASING.md) · [Indeks](INDEX.md)

Workflow .github/workflows/ci.yml menjalankan validasi TypeScript, kompilasi Pawn, dan GitHub Release berbasis tag.

Setiap push ke main, pull request, dan workflow_dispatch menjalankan:
1. Node.js 22 meng-install dependency, type-check, menjalankan tes, dan membangun dist/.
2. scripts/build-pawn.sh mengambil compiler dan includes yang versinya dipatok.
3. Filterscript dikompilasi untuk target SA-MP dan open.mp.
4. Hasil TypeScript dan Pawn diunggah sebagai workflow artifacts.

Jika job validasi gagal, workflow tidak menerbitkan release.

## Terbitkan versi

~~~bash
git checkout main
git pull --ff-only
git tag v0.2.0
git push origin v0.2.0
~~~

Tag v* memicu pipeline. Job publish-release hanya berjalan setelah validate dan build-pawn sukses.

Aset release: samp-ai-vX.Y.Z.zip/.tar.gz, dua AMX target, build-info.txt, dan checksum .sha256. Workflow artifacts biasa bersifat sementara sesuai retention period.

Paket ini adalah reference integration bundle, bukan aplikasi backend lengkap/installer satu klik. Tidak menyertakan token, binary dependency pihak ketiga, database, dashboard admin, atau approval service produksi. Compile sukses bukan bukti live test. Tinjau lisensi proyek/dependency sebelum distribusi.
