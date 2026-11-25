# Self-Expanding Skills

> **Bahasa:** [Indonesia](SELF_EXPANDING_SKILLS.md) | [English](../SELF_EXPANDING_SKILLS.md) · [Indeks](INDEX.md)

Sistem skill dapat diperluas melalui manifest deklaratif agar domain baru dapat ditambahkan tanpa mengubah core.

1. AI/kontributor mengusulkan skill candidate.
2. Loader memvalidasi schema, path, dependency, dan tool binding.
3. Candidate diuji dengan mock tools dan contract tests.
4. Maintainer meninjau permission, compatibility, dan data access.
5. Server owner mengaktifkan skill secara terpisah.

Skill hanya memakai implementation ID terdaftar. Candidate tidak otomatis menjalankan kode baru. Implementasi executable baru membutuhkan kontribusi core/adapter yang direview.
