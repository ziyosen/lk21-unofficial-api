const crypto = require("crypto");

/* Resolver byse (embed byselapuix.com, sumber zonafilm.shop).
   Port dari zona-cinema (scrapper/movies/byse.js) — logika diselaraskan:
   - API /api/videos/<code>/ dengan Referer origin (byselapuix) WAJIB.
   - Playback terenkripsi AES-256-GCM; key = key_parts[version] + key_parts[31-version]
     (1-based index, seperti frontend Byse).
   - Token HLS di URL m3u8 expire 15 menit → JANGAN cache hasil > 10 menit;
     resolver selalu resolve fresh saat /play dipanggil. */

const BYSE_ORIGIN = (process.env.BYSE_ORIGIN || "https://byselapuix.com").replace(/\/+$/, "");
const ZONAFILM_BASE = (process.env.ZONAFILM_BASE || "https://zonafilm.shop/").replace(/([^/])$/, "$1/");

function b64urlDecode(s) {
    return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/* Resolve satu kode embed byse → { file (m3u8), title, poster, expiresAt } */
async function byseResolve(code, log = () => {}) {
    const url = BYSE_ORIGIN + "/api/videos/" + encodeURIComponent(code) + "/";
    const r = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { "Referer": BYSE_ORIGIN + "/", "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });
    if (!r.ok) throw new Error("byse api " + r.status);
    const j = await r.json();
    const pb = j.playback || {};
    const parts = Array.isArray(pb.key_parts) ? pb.key_parts : [];
    if (!pb.iv || !pb.payload || !parts.length) throw new Error("byse playback kosong");
    const v = Number(pb.version);
    if (!Number.isInteger(v) || v < 1 || v >= parts.length || 31 - v < 1 || 31 - v >= parts.length) {
        throw new Error("byse version tidak valid: " + pb.version);
    }
    /* Frontend Byse: indeks 1-based [version, 31-version] → key_parts[i-1] */
    const key = Buffer.concat([b64urlDecode(parts[v - 1]), b64urlDecode(parts[31 - v - 1])]);
    const iv = b64urlDecode(pb.iv);
    const data = b64urlDecode(pb.payload);
    if (data.length < 16) throw new Error("byse payload pendek");
    const tag = data.subarray(data.length - 16);
    const body = data.subarray(0, data.length - 16);
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    const pt = Buffer.concat([d.update(body), d.final()]);
    const out = JSON.parse(pt.toString("utf8"));
    const src = (out.sources || []).find(s => s && s.url && /\.m3u8(\?|$)/.test(s.url)) || (out.sources || [])[0];
    if (!src || !src.url) throw new Error("byse tanpa source HLS");
    log("byse: " + (src.label || src.height || "?") + " → " + src.url.split("?")[0]);
    return {
        file: src.url,
        title: j.title || null,
        poster: j.poster_url || null,
        expiresAt: out.expires_at || null
    };
}

/* Ambil semua kode embed byselapuix dari halaman film zonafilm (link download /d/<code>). */
async function byseCodesFromZonafilm(slug, log = () => {}) {
    const url = ZONAFILM_BASE + encodeURIComponent(slug) + "/";
    const r = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { "Referer": ZONAFILM_BASE, "User-Agent": "Mozilla/5.0" }
    });
    if (!r.ok) return [];
    const html = await r.text();
    const codes = [...new Set((html.match(/byselapuix\.com\/[a-z]\/([A-Za-z0-9]+)/g) || [])
        .map(m => m.split("/").pop()))];
    log("byse: " + codes.length + " kode dari " + slug);
    return codes;
}

/* Jalur lengkap utk /play: slug → kode byse → HLS. Return null kalau tidak ada. */
async function byseHls(slug, log = () => {}) {
    try {
        const codes = await byseCodesFromZonafilm(slug, log);
        for (const code of codes) {
            try {
                const res = await byseResolve(code, log);
                if (res.file) return res;
            } catch (e) {
                log("byse: kode " + code + " gagal: " + e.message);
            }
        }
    } catch (e) {
        log("byse: " + e.message);
    }
    return null;
}

module.exports = { byseResolve, byseCodesFromZonafilm, byseHls };
