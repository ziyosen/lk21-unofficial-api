# Port manual live patches -> branch gdframe (server-app.js)

Dikerjakan: 2026-11-07 ~15:50-16:05 UTC oleh Muse, atas pesan Hermes
(id d82e3645-05cf-4c20-8717-df9b9cbb9bff): Hermes tidak bisa akses
filesystem node VM, jadi Muse yang port manual di VM.

## Basis & cara

- Worktree: /tmp/zt-rebase, dari origin/feature/gdframe-fallback (47cf89a).
- 14/15 file dari /data/apps/zone-cinema/live-patches.diff apply BERSIH
  (git apply --exclude=server.js).
- server.js (live, monolit 709 baris) di-port MANUAL ke server-app.js
  (branch, 424 -> 732 baris) via script /tmp/port_server.py
  (ekstrak blok dari live dgn anchor, semua penggantian diasersi unik).
- Service live :3000 TIDAK disentuh selama port ini.

## Yang di-port dari live

- sharerHls / vidaraHls / episodeHls (resolver 540.php + episode vidara).
- Percobaan sharerHls + episodeHls di /movies/:slug/play dan
  /series/:slug/stream (cabang episode), + warmPlayCache + field direct.
- dynamicHosts / allowDynamicHost / dynamicHostAllowed (allowlist /hls
  dinamis, TTL 8 jam).
- Seg cache: segCache + segPrefetch + segWarmAhead + warmPlayCache
  (prefetch-6, max 200 entri / 200 MB, TTL 8 jam).
- Handler /hls live: single-fetch (tanpa fetch ganda), cache HIT/MISS,
  tunggu prefetch, timeout 30s, rewrite playlist + registrasi host dinamis.
- Timeout fetch 15s (sharer/vidara/episode), polaEp tahun opsional
  (slug episode tanpa tahun).

## Yang dipertahankan dari branch (jangan hilang)

- gdframeResolve + fallback gdframe di /movies/:slug/play dan
  /movies/:slug/stream (termasuk perbaikan fallback 47cf89a).
- Handler /movies/:slug/stream branch dipakai APA ADANYA (versi live
  masih handler lama pra-perbaikan fallback).
- module.exports = app (tanpa app.listen; listen tetap di shim server.js).
- Allowlist /hls DIGABUNG: stream121.space + gdriveplayer.to (gdframe)
  tetap ada di samping seneng.store / s1q2105.com / esse.* / *.xyz +
  allowlist dinamis. Referer segmen stream121.space -> gdriveplayer.to.

## Verifikasi (smoke test, server uji :3100, live :3000 tak disentuh)

- node --check server-app.js + server.js: OK.
- GET / -> 200; GET /movies/latest -> 200.
- /movies/band-of-brothers-legacy-2026/play -> 200 via sharerHls
  (seneng.store). REGRESI TERTUTUP: kontrol branch murni (:3101)
  memberi 404 untuk slug yang sama.
- /hls?u=<m3u8 seneng> -> 200, Content-Type mpegurl, playlist
  di-rewrite ke /hls?u=... (segmen esse.rosmala.online).
- /movies/last-order-final-fantasy-vii-2005/stream -> 404
  (vidara: stream kosong | gdframe: NOT_FOUND). SAMA PERSIS dengan
  kontrol branch murni (:3101) -> BUKAN regresi port; ini masalah
  slug-mapping yang masih terbuka (katalog slug -> data.php NOT_FOUND).

## Status push

- Commit LOKAL saja di branch rebase/gdframe-live (worktree ini).
- TIDAK ADA push ke GitHub: deploy freeze Bos (2026-10-11) masih
  berlaku (kerja lokal/VPS dulu, Bos review, baru commit/push).
- Langkah berikut: Hermes review port ini -> Bos setuju push ->
  Muse push branch rebase/gdframe-live -> Hermes verifikasi dari
  VPS + deploy final bersama -> baru web chat grup dibangun.
