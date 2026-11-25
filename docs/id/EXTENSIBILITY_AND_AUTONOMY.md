# Ekstensibilitas dan Otonomi AI

> **Bahasa:** [Indonesia](EXTENSIBILITY_AND_AUTONOMY.md) | [English](../EXTENSIBILITY_AND_AUTONOMY.md) · [Indeks](INDEX.md)

SAMP.AI dirancang sebagai platform skill/tool untuk mapping, TextDraw, diagnostics, resource assistance, database planning, gameplay, NPC, testing, dan dokumentasi.

Extension mendeklarasikan manifest, dependency, compatibility, permission, data access, tool binding, dan skill. Skill menggunakan typed tools yang telah terdaftar; model tidak menjalankan arbitrary script.

Siklus: candidate → maintainer review → server-owner enablement. Candidate tetap disabled sampai ditinjau dan diaktifkan owner.

Mode otonomi: observe, suggest, draft_only, apply_with_approval, restricted_automation. Jangan beri model arbitrary shell, Pawn/C++ execution, unrestricted filesystem/SQL, atau kemampuan mengaktifkan skill sendiri.
