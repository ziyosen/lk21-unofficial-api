// byse.js — resolver untuk embed bysesayeveum.com (platform "byse").
// Reverse-engineering 28 Nov 2026, TERBUKTI ujung-ke-ujung 2 film
// (desperada-2026 + dont-do-it-with-my-wife-2026; master+variant+segmen .ts 200).
// Alur: POST /api/videos/<code>/embed/captcha -> PoW (hash CUSTOM gr,
//   BUKAN SHA-256 standar) -> POST .../captcha/verify -> token (1800 dtk,
//   di-cache + dipakai ulang) -> POST .../embed/playback
//   (body {"fingerprint":{}} + header X-Captcha-Token)
//   -> dekripsi AES-256-GCM (key parts by version) -> sources[0] = HLS master.
// Dipakai sebagai SATU JALUR LAGI di /play + /stream, setelah
// sharer/vidara/gdframe gagal, atau untuk film yang embed-nya bysesayeveum.
// JANGAN ganti resolver yang sudah ada.
"use strict";

// ---------------------------------------------------------------------------
// PoW: hash custom "gr" + solver "Er" (port dari pow-DEJGtdh2.js bundle).
// Hash-nya BUKAN SHA-256 standar meski algorithm menyebut
// "sha256-leading-zero-bits": state awal = 4 konstanta awal SHA-256, lalu
// mixing ARX + array state 512 word + 2 ronde shuffle, output 8 word.
// Solver memakai kode ASLI ini (bukan crypto.createHash('sha256')).
// Terbukti: nonce fa640448b16fe7c95b70677fe998d7d7 diff 16 -> "86091" (707 ms).
// ---------------------------------------------------------------------------
const POW_BE = 512;            // ukuran array state gr
const POW_LT = POW_BE - 1;     // mask indeks (511)
const POW_DR = 2;              // ronde shuffle gr
const POW_LR = 2654435761;     // 0x9E3779B1
const POW_HR = 2246822519;     // 0x85EBCA6B
const _rotl = (t, e) => (t << e | t >>> (32 - e)) >>> 0;
const _imul = (t, e) => Math.imul(t, e) >>> 0;

function _ye(t) {
    t[0] = t[0] + t[1] >>> 0, t[3] = _rotl(t[3] ^ t[0], 16), t[2] = t[2] + t[3] >>> 0, t[1] = _rotl(t[1] ^ t[2], 12),
    t[0] = t[0] + t[1] >>> 0, t[3] = _rotl(t[3] ^ t[0], 8), t[2] = t[2] + t[3] >>> 0, t[1] = _rotl(t[1] ^ t[2], 7);
}

function _gr(t) {
    const e = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762]);
    for (let i = 0; i < t.length; i++) e[0] = e[0] + t[i] >>> 0, e[0] = _rotl(e[0], 7), _ye(e);
    for (let i = 0; i < 8; i++) _ye(e);
    const r = new Uint32Array(POW_BE);
    for (let i = 0; i < POW_BE; i++) _ye(e), r[i] = (e[0] ^ e[2]) >>> 0;
    for (let i = 0; i < POW_DR; i++) for (let s = 0; s < POW_BE; s++) {
        const a = r[s] & POW_LT;
        let c = r[s] + r[a] >>> 0;
        c = _rotl(c, 13), c = (c ^ _imul(r[s + 1 & POW_LT], POW_LR)) >>> 0, r[s] = c, e[0] = (e[0] ^ c) >>> 0, _ye(e);
    }
    const n = new Uint32Array(8), o = POW_BE / 8;
    for (let i = 0; i < 8; i++) {
        _ye(e);
        let s = e[0];
        const a = i * o;
        for (let c = 0; c < o; c++) {
            const d = r[a + c];
            s = s + d >>> 0, s = _rotl(s, 5), s = (s ^ _imul(d, POW_HR)) >>> 0;
        }
        n[i] = (s ^ e[2]) >>> 0;
    }
    return n;
}

function _wr(t) {
    let e = 0;
    for (let r = 0; r < t.length; r++) {
        const n = t[r];
        if (n === 0) { e += 32; continue; }
        return e + Math.clz32(n);
    }
    return e;
}

function _yr(t) {
    const e = new Uint8Array(t.length);
    for (let r = 0; r < t.length; r++) e[r] = t.charCodeAt(r) & 255;
    return e;
}

const _yield = () => new Promise((t) => { setTimeout(t, 0); });

// Cari counter s sehingga hash(nonce + ":" + s) punya leading zero bits
// >= difficulty. Mengembalikan String(s), atau null kalau budget habis.
// Batch 1024 + yield antar batch supaya event loop tidak terblokir lama.
async function _solvePow(nonce, difficulty, budgetMs) {
    if (difficulty <= 0) return "0";
    const budget = budgetMs || 20000;
    const prefix = nonce + ":";
    const start = Date.now();
    let s = 0;
    const batch = 1024;
    for (;;) {
        for (let c = 0; c < batch; c++) {
            const d = _gr(_yr(prefix + s));
            if (_wr(d) >= difficulty) return String(s);
            s++;
        }
        if (Date.now() - start > budget) return null;
        await _yield();
    }
}

// ---------------------------------------------------------------------------
// API client embed byse (same-origin JSON API di host embed itu sendiri).
// Host embed DIBACA dari URL iframe detail (jangan hardcode) — keluarga
// "byse" sering ganti domain (bysesayeveum.com, n1mwq.org, socket.byse.sx).
// ---------------------------------------------------------------------------
const BYSE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Cache token captcha per embed code: token berlaku 1800 dtk, bisa dipakai
// ulang untuk beberapa playback sampai kedaluwarsa (hemat 1 ronde PoW/film).
const _tokenCache = new Map(); // code -> { token, expiresAt }

function byseEmbedInfo(embedUrl) {
    const m = /^(https?:\/\/[^\/]+)\/e\/([A-Za-z0-9_-]+)/.exec(embedUrl || "");
    if (!m) return null;
    return { origin: m[1], code: m[2] };
}

function _byseHeaders(parentUrl, embedOrigin) {
    let origin = embedOrigin;
    try { if (parentUrl) origin = new URL(parentUrl).origin; } catch (e) {}
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": BYSE_UA,
        "Referer": parentUrl || embedOrigin,
        "X-Embed-Origin": origin,
        "X-Embed-Referer": parentUrl || embedOrigin,
        "X-Embed-Parent": origin,
    };
}

async function _byseCaptcha(code, embedOrigin, parentUrl) {
    const r = await fetch(`${embedOrigin}/api/videos/${code}/embed/captcha`, {
        signal: AbortSignal.timeout(8000),
        method: "POST",
        headers: _byseHeaders(parentUrl, embedOrigin),
        body: "{}",
    });
    if (!r.ok) throw new Error("byse captcha HTTP " + r.status);
    const j = await r.json();
    if (!j.pow_nonce || !j.pow_token) throw new Error("byse captcha: no challenge");
    return j;
}

async function _byseVerifyCaptcha(code, powToken, solution, embedOrigin, parentUrl) {
    const r = await fetch(`${embedOrigin}/api/videos/${code}/embed/captcha/verify`, {
        signal: AbortSignal.timeout(8000),
        method: "POST",
        headers: _byseHeaders(parentUrl, embedOrigin),
        body: JSON.stringify({ pow_token: powToken, solution: String(solution) }),
    });
    if (!r.ok) throw new Error("byse verify HTTP " + r.status);
    const j = await r.json();
    if (j.status !== "ok" || !j.token) throw new Error("byse verify: " + (j.reason || "invalid"));
    return j;
}

async function _bysePlayback(code, captchaToken, embedOrigin, parentUrl) {
    const r = await fetch(`${embedOrigin}/api/videos/${code}/embed/playback`, {
        signal: AbortSignal.timeout(8000),
        method: "POST",
        headers: Object.assign({}, _byseHeaders(parentUrl, embedOrigin), { "X-Captcha-Token": captchaToken }),
        body: JSON.stringify({ fingerprint: {} }),
    });
    if (!r.ok) throw new Error("byse playback HTTP " + r.status);
    const j = await r.json();
    if (!j.playback) throw new Error("byse playback: no playback field");
    return j.playback;
}

// ---------------------------------------------------------------------------
// Dekripsi payload playback (AES-256-GCM).
// version "n" -> pakai key part ke-n dan ke-(31-n) (1-indexed); kalau version
// tidak dikenal / indeks di luar jangkauan -> pakai semua part.
// Kunci = concat base64url-decode part terpilih (2 x 16 byte = 32 byte).
// ---------------------------------------------------------------------------
function _b64urlDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, "base64");
}

async function byseDecrypt(playback) {
    const parts = Array.isArray(playback.key_parts) ? playback.key_parts : [];
    let sel = parts;
    const n = parseInt(String(playback.version || "").trim(), 10);
    if (Number.isInteger(n) && n >= 1 && n <= 20) {
        const pair = [n, 31 - n];
        if (pair[0] >= 1 && pair[1] >= 1 && pair[0] <= parts.length && pair[1] <= parts.length) {
            sel = [parts[pair[0] - 1], parts[pair[1] - 1]].filter((x) => typeof x === "string" && x.length > 0);
            if (!sel.length) sel = parts;
        }
    }
    const key = Buffer.concat(sel.filter((x) => typeof x === "string" && x.length > 0).map(_b64urlDecode));
    const iv = _b64urlDecode(playback.iv);
    const ct = _b64urlDecode(playback.payload);
    const ck = await require("crypto").webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
    const pt = await require("crypto").webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, ck, ct);
    return JSON.parse(Buffer.from(pt).toString("utf8"));
}

// ---------------------------------------------------------------------------
// Entry utama: embed URL -> HLS master.m3u8.
// embedUrl: https://<host>/e/<code>/ (dari iframe detail layarkaca21.city).
// parentUrl: URL detail film (https://layarkaca21.city/<slug>/), untuk header.
// Mengembalikan { hls, label, sources } atau throw (pemanggil jatuhkan ke 404).
// Penanganan gagal (sesuai riset): PoW gagal 2-3x / image captcha / reCAPTCHA
// tidak bisa diselesaikan server-side -> throw, pemanggil balas
// "resolver belum tersedia" (jangan menggantung; patuhi deadline /play 15 dtk).
// ---------------------------------------------------------------------------
async function byseResolve(embedUrl, parentUrl, opts) {
    const info = byseEmbedInfo(embedUrl);
    if (!info) throw new Error("byse: embed URL tidak dikenali");
    const origin = info.origin, code = info.code;
    const powBudgetMs = (opts && opts.powBudgetMs) || 10000;

    let token = null;
    const cached = _tokenCache.get(code);
    if (cached && cached.expiresAt > Date.now() + 60000) token = cached.token;

    if (!token) {
        const cap = await _byseCaptcha(code, origin, parentUrl);
        const difficulty = parseInt(cap.pow_difficulty, 10) || 16;
        const solution = await _solvePow(cap.pow_nonce, difficulty, powBudgetMs);
        if (solution === null) throw new Error("byse: PoW gagal / timeout");
        const ver = await _byseVerifyCaptcha(code, cap.pow_token, solution, origin, parentUrl);
        token = ver.token;
        const expIn = parseInt(ver.expires_in, 10) || 1800;
        _tokenCache.set(code, { token, expiresAt: Date.now() + expIn * 1000 });
    }

    const playback = await _bysePlayback(code, token, origin, parentUrl);
    const data = await byseDecrypt(playback);
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const best = sources.find((s) => s && s.url) || null;
    if (!best) throw new Error("byse: tidak ada sources");
    return { hls: best.url, label: best.label || "1080p", sources, title: data.title || null };
}

module.exports = { byseResolve, byseEmbedInfo, byseDecrypt, _solvePow };
