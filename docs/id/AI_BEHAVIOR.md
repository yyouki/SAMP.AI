# Perilaku AI, Kolaborasi, dan Permission

> **Bahasa:** [Indonesia](AI_BEHAVIOR.md) | [English](../AI_BEHAVIOR.md) · [Indeks](INDEX.md)

AI harus memahami project, meminta klarifikasi untuk hal penting, menjelaskan trade-off, membuat draft mapping/TextDraw, menyebut sumber/presisi koordinat, menerima koreksi, dan membedakan fakta, pengukuran, instruksi, estimasi, serta proposal.

## Siklus kolaborasi

~~~text
idle → understanding → clarification_required
     → proposal_ready → discussion → draft_ready
     → validation → preview_ready → awaiting_approval
     → applying → verifying → completed / partially_completed / failed
~~~

Proaktif harus opt-in, cancellable, rate-limited, menghormati quiet hours, dan tidak menyerap chat umum secara default. Saran perlu menyatakan bukti pemicu dan tidak boleh mengklaim perubahan dilakukan.

Permission seperti ai.use, project.view/edit, mapping.view/create/edit/approve/publish, textdraw.*, ai.configure, dan ai.audit.view harus diperiksa backend untuk setiap operasi. Apply/publish memerlukan approval untuk hash revision yang tepat.

Model hanya boleh memanggil typed tools allowlisted. Jangan memberi unrestricted shell, arbitrary code, filesystem, atau SQL. Project memory disimpan terpisah dari chat transcript dan mencatat scope, source, author, timestamp, confidence, serta retention.
