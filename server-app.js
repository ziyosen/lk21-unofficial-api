const express = require("express");
const cheerio = require("cheerio");
const { ambil } = require("./scrapper/fetcher");
const { gdframeResolve } = require("./scrapper/gdframe");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();

const {
    getGenresMovies,
    getMovieByGenre,
    getCountriesMovies,
    getMovieByCountry,
    getYearsMovies,
    getMovieByYears,
    searchMovie,
    latestMovies,
    streamMovies
} = require("./scrapper/movies");

const { 
    getGenresSeries,
    getSeriesByGenre,
    getCountriesSeries,
    getSeriesByCountry,
    getYearsSeries,
    getSeriesByYears,
    streamSeries,
    getEpisode

 } = require("./scrapper/series");
const app = express();
const PORT = process.env.PORT || 3000;
// Base publik untuk link HLS — kalau diisi (mis. https://bridge.xinquins.de5.net/lk21-api),
// URL hls jadi ABSOLUT ke situ (VPS, tanpa timeout Vercel); kalau kosong tetap relatif.
const HLS_PUBLIC_BASE = (process.env.HLS_PUBLIC_BASE || "").replace(/\/+$/, "");
function hlsUrl(fileUrl) {
    const path = "/hls?u=" + encodeURIComponent(fileUrl);
    return HLS_PUBLIC_BASE ? HLS_PUBLIC_BASE + path : path;
}

// Jalur baru (tema lk21official.website): sharer.link 540.php -> m3u8 langsung.
// POST movie=<slug> dgn Referer; balas JSON {success, player, data:[{file,label,type}]}.
async function sharerHls(slug) {
    const body = new URLSearchParams({
        r: (process.env.LK21_BASE_MOVIE || "") + slug,
        d: "sharer.link"
    });
    const resp = await fetch("https://sharer.link/540.php?movie=" + encodeURIComponent(slug), {
        signal: AbortSignal.timeout(15000),
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://sharer.link/p2p.php?movie=" + encodeURIComponent(slug),
            "User-Agent": "Mozilla/5.0"
        },
        body: body
    });
    const j = await resp.json();
    if (!j || !j.success || !Array.isArray(j.data) || !j.data.length) return null;
    const cands = j.data.filter(function (x) { return x && x.file && /\.m3u8(\?|$)/.test(x.file); });
    if (!cands.length) return null;
    const src = cands.find(function (x) { return /540/.test(x.label || ""); }) || cands[0];
    if (!src || !src.file) return null;
    return { file: src.file, poster: (j.player && j.player.poster_file) ? j.player.poster_file : null };
}

// Episode series lk21asia: halaman /eps/<slug>/ -> post_id + tab player ->
// admin-ajax muvipro_player_content -> iframe vidara.to -> /api/stream -> m3u8.
// Token vidara dibuat fresh tiap /api/stream; /play memanggilnya saat request
// sehingga URL yang dikembalikan ke frontend masih baru.
async function vidaraHls(filecode) {
    const resp = await fetch("https://vidara.to/api/stream", {
        signal: AbortSignal.timeout(15000),
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Referer": "https://vidara.to/e/" + filecode,
            "User-Agent": "Mozilla/5.0"
        },
        body: JSON.stringify({ filecode: filecode, device: "web", codecs: [] })
    });
    const j = await resp.json();
    if (j && j.streaming_url && /\.m3u8/.test(j.streaming_url)) {
        allowDynamicHost(j.streaming_url);
        return j.streaming_url;
    }
    return null;
}

async function episodeHls(slug) {
    const base = process.env.LK21_BASE_SERIES || "";
    const pageRes = await fetch(base + "eps/" + encodeURIComponent(slug) + "/", {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0", "Referer": base }
    });
    const html = await pageRes.text();
    const $ = cheerio.load(html);
    const title = $("h1.entry-title").first().text().trim() || slug;
    const poster = $("meta[property=\"og:image\"]").attr("content") || null;
    const pid = ($("#muvipro_player_content_id").attr("data-id") || "").trim();
    if (!pid) return null;
    const tabs = [];
    $("ul.muvipro-player-tabs a").each((i, el) => {
        const href = $(el).attr("href") || "";
        if (href.startsWith("#")) tabs.push(href.slice(1));
    });
    if (!tabs.length) tabs.push("p1");
    for (const tab of tabs) {
        try {
            const ajax = await fetch(base + "wp-admin/admin-ajax.php", {
                signal: AbortSignal.timeout(15000),
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Referer": base + "eps/" + slug + "/",
                    "User-Agent": "Mozilla/5.0"
                },
                body: "action=muvipro_player_content&tab=" + encodeURIComponent(tab) + "&post_id=" + encodeURIComponent(pid)
            });
            const frag = await ajax.text();
            const $f = cheerio.load(frag);
            let src = $f("iframe").attr("src") || "";
            if (!src) {
                const m0 = /https?:\/\/[^"'\s<>]+/i.exec(frag);
                if (m0) src = m0[0];
            }
            if (!src) continue;
            const vm = /vidara\.to\/e\/([A-Za-z0-9]+)/.exec(src);
            if (vm) {
                const file = await vidaraHls(vm[1]);
                if (file) return { file: file, title: title, poster: poster };
            }
            // morencius.com: embed ter-obfuscate, belum didukung — lanjut tab berikut
        } catch (e) { /* coba tab berikut */ }
    }
    return null;
}

// Developer info
const Developers = {
    name: "LK21 Unofficial API",
    author: "KenXinDev",
    github: "https://github.com/KenXinDev/"
};

// Middleware
app.use(cors());
if (process.env.NODE_ENV !== "production") {
    app.use(morgan("dev"));
}


// ===== HLS PLAY (proxy streaming) =====
const http = require("http");
const https = require("https");

app.get("/movies/:slug/play", async (req, res) => {
    try {
        // Jalur baru: sharer.link 540.php -> m3u8 langsung (tema baru tanpa iframe#main-player)
        try {
            const sh = await sharerHls(req.params.slug);
            if (sh && sh.file) {
                let title = req.params.slug;
                let poster = sh.poster || null;
                try {
                    const pg = await ambil((process.env.LK21_BASE_MOVIE || "") + req.params.slug);
                    const $p = cheerio.load(pg.data);
                    const h1 = $p("h1").first().text().trim().replace(/\s+Sub Indo di Lk21\s*$/i, "");
                    if (h1) title = h1;
                    if (!poster) poster = $p("meta[property=\"og:image\"]").attr("content") || null;
                } catch (e) {}
                warmPlayCache(sh.file); // head start: panaskan segmen sebelum player minta
                return res.json({ status: true, title: title, poster: poster, hls: hlsUrl(sh.file), direct: sh.file });
            }
        } catch (e) { /* lanjut ke jalur lama */ }
        // Episode series (lk21asia): player muvipro AJAX -> vidara.to -> m3u8
        if (/-season-\d+-episode-\d+(?:-\d{4})?$/i.test(req.params.slug)) {
            try {
                const ep = await episodeHls(req.params.slug);
                if (ep && ep.file) {
                    warmPlayCache(ep.file); // head start: panaskan segmen sebelum player minta
                    return res.json({ status: true, title: ep.title || req.params.slug, poster: ep.poster || null, hls: hlsUrl(ep.file), direct: ep.file });
                }
            } catch (e) { /* lanjut ke jalur lama */ }
        }
        // Coba film dulu (tv12), lalu series (tv9) — katalog mencampur keduanya
        let iframe = null;
        for (const base of [process.env.LK21_BASE_MOVIE, process.env.LK21_BASE_SERIES]) {
            if (!base) continue;
            try {
                const page = await ambil(`${base}${req.params.slug}`);
                const $p = cheerio.load(page.data);
                const src = $p("iframe#main-player").attr("src");
                if (src) { iframe = src; break; }
            } catch (e) { /* lanjut ke base berikutnya */ }
        }
        // Series tanpa episode: coba episode pertama (slug-season-1-episode-1-tahun)
        if (!iframe) {
            const ym = /-(\d{4})$/.exec(req.params.slug);
            if (ym) {
                const epSlug = `${req.params.slug.slice(0, -5)}-season-1-episode-1-${ym[1]}`;
                try {
                    const page = await ambil(`${process.env.LK21_BASE_SERIES}${epSlug}`);
                    const $p = cheerio.load(page.data);
                    iframe = $p("iframe#main-player").attr("src") || null;
                    if (iframe) {
                        /* lanjut ke resolve HLS di bawah */ }
                } catch (e) {}
            }
        }
        if (!iframe) {
            try {
                const g = await gdframeResolve(req.params.slug);
                return res.json({ status: true, title: req.params.slug, poster: null, hls: hlsUrl(g.hlsFinal), provider: "gdframe", hls_final: g.hlsFinal });
            } catch (e) {
                return res.status(404).json({ status: false, message: "Player tidak ditemukan" });
            }
        }
        const m = /\/iframe3\/([a-z0-9]+)\/([A-Za-z0-9_-]+)/.exec(iframe);
        if (!m) return res.status(404).json({ status: false, message: "ID player tidak terbaca" });
        const [, host, id] = m;
        // 1) embedUrl dari videonode api.php
        const embedRes = await fetch("https://videonode.de/api.php", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": iframe, "User-Agent": "Mozilla/5.0" },
            body: `host=${host}&id=${id}`
        });
        const embedJson = await embedRes.json();
        const embed = embedJson.embedUrl;
        if (!embed) return res.status(502).json({ status: false, message: "embedUrl kosong" });
        // 2) verify → fileUrl
        const slug2 = new URL(embed).pathname.split("/").filter(Boolean).pop();
        const ver = await fetch("https://playcdn.de/verify/" + encodeURIComponent(slug2), { headers: { "Referer": embed, "User-Agent": "Mozilla/5.0" } });
        const verJson = await ver.json();
        if (!verJson.fileUrl) return res.status(502).json({ status: false, message: "fileUrl kosong" });
        warmPlayCache(verJson.fileUrl); // head start: panaskan segmen sebelum player minta
        res.json({ status: true, title: verJson.title, poster: verJson.poster, hls: hlsUrl(verJson.fileUrl), direct: verJson.fileUrl });
    } catch (err) {
        res.status(500).json({ status: false, message: err.message });
    }
});

// Host CDN vidara yang diizinkan /hls — didaftarkan dinamis tiap /play
// memanggil vidara API. Host CDN vidara rotasi per file (s1q2105.com,
// 97bf1.com, ...) sehingga tak bisa whitelist statis. Hanya host yang
// server sendiri dapat dari vidara.to yang masuk; kedaluwarsa 8 jam.
const dynamicHosts = new Map();
function allowDynamicHost(fileUrl) {
    try {
        const h = new URL(fileUrl).hostname;
        dynamicHosts.set(h, Date.now() + 8 * 3600 * 1000);
    } catch (e) {}
}
function dynamicHostAllowed(h) {
    const exp = dynamicHosts.get(h);
    if (!exp) return false;
    if (Date.now() > exp) { dynamicHosts.delete(h); return false; }
    return true;
}

// Proxy HLS: rewrite playlist agar segmen lewat kita juga
const rlMap = new Map(); // ip -> {count, reset}
function rateLimit(req, res, max, windowMs) {
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const now = Date.now();
    let e = rlMap.get(ip);
    if (!e || now > e.reset) { e = { count: 0, reset: now + windowMs }; rlMap.set(ip, e); }
    e.count++;
    if (rlMap.size > 5000) rlMap.clear(); // jaga memori
    if (e.count > max) { res.status(429).end("Terlalu banyak request, tunggu sebentar."); return false; }
    return true;
}

// Pre-warm cache /hls (2026-11-07): prefetch 2-3 segmen ke depan supaya
// segmen lambat/flaky (host s501740, 44-210KB/s) sudah ada di memori saat
// player memintanya. Segmen kini berekstensi .woff (~55KB), bukan .ts —
// cache menyimpan buffer + content-type apa adanya, tanpa asumsi ekstensi.
const SEG_CACHE_MAX_ENTRIES = 200;
const SEG_CACHE_MAX_BYTES = 200 * 1024 * 1024; // 200MB
const SEG_CACHE_TTL = 8 * 3600 * 1000; // 8 jam, sejalan allowlist dinamis
const segCache = new Map(); // url -> {buf, ct, ts}
let segCacheBytes = 0;
const segInflight = new Set(); // url yang sedang di-prefetch
const segIndex = new Map(); // segUrl -> {list, idx}
function segCachePrune() {
    while ((segCache.size > SEG_CACHE_MAX_ENTRIES || segCacheBytes > SEG_CACHE_MAX_BYTES) && segCache.size) {
        const k = segCache.keys().next().value;
        segCacheBytes -= segCache.get(k).buf.length;
        segCache.delete(k);
    }
}
function segCacheSet(url, buf, ct) {
    const old = segCache.get(url);
    if (old) segCacheBytes -= old.buf.length;
    segCache.set(url, { buf, ct, ts: Date.now() });
    segCacheBytes += buf.length;
    segCachePrune();
}
function segCacheGet(url) {
    const e = segCache.get(url);
    if (!e) return null;
    if (Date.now() - e.ts > SEG_CACHE_TTL) { segCacheBytes -= e.buf.length; segCache.delete(url); return null; }
    return e;
}
function segContentType(ctUp) {
    const isMedia = /^(video|audio)\//.test(ctUp) || ctUp.includes("octet-stream");
    return isMedia ? ctUp : "video/mp2t";
}
async function segPrefetch(url) {
    if (segCacheGet(url) || segInflight.has(url)) return;
    let h; try { h = new URL(url).hostname; } catch { return; }
    if (!/(^|\.)playcdn\.de$|(^|\.)videonode\.de$|(^|\.)seneng\.store$|(^|\.)s1q2105\.com$|^esse\.[a-z0-9-]+\.[a-z]+$|^[a-z]+\.[a-z]+\.xyz$|(^|\.)stream121\.space$|(^|\.)gdriveplayer\.to$/.test(h) && !dynamicHostAllowed(h)) return;
    const ref = (/seneng\.store$|^esse\./.test(h)) ? "https://sharer.link/" : (/s1q2105\.com$/.test(h) ? "https://vidara.to/" : (/stream121\.space$/.test(h) ? "https://gdriveplayer.to/" : "https://playcdn.de/"));
    segInflight.add(url);
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "Mozilla/5.0", "Referer": ref } });
        if (!r.ok) return;
        segCacheSet(url, Buffer.from(await r.arrayBuffer()), segContentType(r.headers.get("content-type") || ""));
    } catch (e) { /* prefetch gagal diam-diam; request asli tetap fetch langsung */ }
    finally { segInflight.delete(url); }
}
function segWarmAhead(list, idx, n) {
    for (let i = 1; i <= n; i++) {
        const u = list[idx + i];
        if (u) segPrefetch(u); // fire-and-forget
    }
}

// Warm cache saat /play (2026-11-07): /play memberi head start — ambil
// playlist m3u8 di server & prefetch 6 segmen pertama SEBELUM player minta
// seg#0. Fire-and-forget: /play tidak menunggu prefetch selesai.
// Master playlist (vidara: 1 varian) diikuti ke varian dulu.
async function warmPlayCache(fileUrl) {
    try {
        let h; try { h = new URL(fileUrl).hostname; } catch { return; }
        const ref = (/seneng\.store$|^esse\./.test(h)) ? "https://sharer.link/" : (/s1q2105\.com$/.test(h) ? "https://vidara.to/" : (/stream121\.space$/.test(h) ? "https://gdriveplayer.to/" : "https://playcdn.de/"));
        const r = await fetch(fileUrl, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "Mozilla/5.0", "Referer": ref } });
        if (!r.ok) return;
        const txt = await r.text();
        if (/#EXT-X-STREAM-INF/.test(txt)) {
            const lines = txt.split("\n").map(x => x.trim()).filter(x => x && !x.startsWith("#"));
            if (!lines.length) return;
            return warmPlayCache(new URL(lines[0], new URL(fileUrl)).toString());
        }
        const base = new URL(fileUrl);
        const segList = [];
        for (const line of txt.split("\n")) {
            const t = line.trim();
            if (t && !t.startsWith("#")) { try { segList.push(new URL(t, base).toString()); } catch (e) {} }
        }
        for (const m of txt.matchAll(/https?:\/\/[^"'\s<>]+/g)) { try { allowDynamicHost(m[0]); } catch (e) {} }
        for (const u of segList) allowDynamicHost(u);
        if (segList.length) {
            for (let i = 0; i < segList.length; i++) segIndex.set(segList[i], { list: segList, idx: i });
            segWarmAhead(segList, -1, 6); // panaskan 6 segmen pertama
        }
    } catch (e) { /* warm gagal diam-diam; /hls tetap jalan normal */ }
}

app.get("/hls", async (req, res) => {
    if (!rateLimit(req, res, 900, 60000)) return;
    const u = req.query.u;
    if (!u || !/^https?:\/\//.test(u)) return res.status(400).end("bad url");
    // Anti-SSRF: hanya izinkan host video yang dipakai player (review sonnet-4.5)
    let h; try { h = new URL(u).hostname; } catch { return res.status(400).end("bad url"); }
    // CDN rotasi sumber memakai pola <hewan>.<brand>.xyz (duck/bunny/cat/... × qornexia/blaytoro/...)
    if (!/(^|\.)playcdn\.de$|(^|\.)videonode\.de$|(^|\.)seneng\.store$|(^|\.)s1q2105\.com$|^esse\.[a-z0-9-]+\.[a-z]+$|^[a-z]+\.[a-z]+\.xyz$|(^|\.)stream121\.space$|(^|\.)gdriveplayer\.to$/.test(h) && !dynamicHostAllowed(h)) return res.status(403).end("host tidak diizinkan");
    const ref = (/seneng\.store$|^esse\./.test(h)) ? "https://sharer.link/" : (/s1q2105\.com$/.test(h) ? "https://vidara.to/" : (/stream121\.space$/.test(h) ? "https://gdriveplayer.to/" : "https://playcdn.de/"));
    try {
        const r = await fetch(u, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "Mozilla/5.0", "Referer": ref } });
        const ct = r.headers.get("content-type") || "";
        if (u.includes(".m3u8") || ct.includes("mpegurl")) {
            let txt = await r.text();
            const base = new URL(u);
            const segList = [];
            for (const line of txt.split("\n")) {
                const t = line.trim();
                if (t && !t.startsWith("#")) { try { segList.push(new URL(t, base).toString()); } catch (e) {} }
            }
            // Daftarkan host segmen yang disebut playlist ini (prefix + brand
            // CDN seneng.store rotasi: esse./fast./... x rosmala/bisniskreatif/...).
            // Hanya host yang server sendiri lihat di playlist dari sumber
            // yang sudah diizinkan yang masuk; segmen dicek ke allowlist ini.
            for (const m of txt.matchAll(/https?:\/\/[^"'\s<>]+/g)) {
                try { allowDynamicHost(m[0]); } catch (e) {}
            }
            txt = txt.split("\n").map(line => {
                const t = line.trim();
                if (!t || t.startsWith("#")) {
                    // rewrite URI="..." di tag
                    return line.replace(/URI="([^"]+)"/g, (_, x) => 'URI="/hls?u=' + encodeURIComponent(new URL(x, base).toString()) + '"');
                }
                return "/hls?u=" + encodeURIComponent(new URL(t, base).toString());
            }).join("\n");
            if (segList.length) {
                for (let i = 0; i < segList.length; i++) segIndex.set(segList[i], { list: segList, idx: i });
                if (segIndex.size > 20000) { for (const k of segIndex.keys()) { segIndex.delete(k); if (segIndex.size <= 15000) break; } }
                segWarmAhead(segList, -1, 6); // panaskan 6 segmen pertama playlist
            }
            res.set("Content-Type", "application/vnd.apple.mpegurl");
            res.set("Cache-Control", "no-store");
            return res.send(txt);
        }
        // segmen binary → pipe response fetch #1 langsung (JANGAN fetch ulang:
        // fetch ganda = 2 koneksi berebut bandwidth, segmen jadi 3x lebih lambat)
        // Pre-warm: kalau segmen sudah di-cache (di-prefetch saat segmen
        // sebelumnya diminta), sajikan dari memori — tanpa fetch ke CDN.
        const cached = segCacheGet(u);
        const ent = segIndex.get(u);
        if (ent) segWarmAhead(ent.list, ent.idx, 6);
        if (cached) {
            res.set("Content-Type", cached.ct);
            res.set("Cache-Control", "public, max-age=86400");
            res.set("X-Zona-Cache", "HIT");
            return res.send(cached.buf);
        }

        // Kalau segmen sedang di-prefetch (mis. warm saat /play), tunggu
        // hasilnya daripada fetch ganda berebut bandwidth ke CDN lambat.
        // Prefetch gagal -> segInflight hilang -> lanjut fetch langsung.
        if (segInflight.has(u)) {
            const t0 = Date.now();
            let waited = null;
            while (Date.now() - t0 < 30000) {
                await new Promise(r => setTimeout(r, 200));
                waited = segCacheGet(u);
                if (waited) break;
                if (!segInflight.has(u)) break;
            }
            if (waited) {
                res.set("Content-Type", waited.ct);
                res.set("Cache-Control", "public, max-age=86400");
                res.set("X-Zona-Cache", "HIT-wait");
                return res.send(waited.buf);
            }
        }
        res.set("X-Zona-Cache", "MISS");
        const ctUp = ct;
        // CDN kadang salah label segmen TS (image/x-pict, font/woff, ...) — paksa
        // video/mp2t bila tipenya bukan media, biar player HP ketat tetap terima
        const isMedia = /^(video|audio)\//.test(ctUp) || ctUp.includes("octet-stream");
        res.set("Content-Type", isMedia ? ctUp : "video/mp2t");
        res.set("Cache-Control", "public, max-age=86400");
        const reader = r.body.getReader();
        req.on("close", () => reader.cancel().catch(()=>{}));
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.write(value)) { await new Promise(ok => res.once("drain", ok)); }
        }
        res.end();
    } catch (err) {
        res.status(502).end("proxy error: " + err.message);
    }
});

// Front end statis

app.use(express.static(__dirname + "/public"));

// API root
app.get("/api", (_, res) => {
    res.json({
        status: true,
        developers: Developers,
        message: "Welcome to LK21 Unofficial API"
    });
});

app.get("/movies/:slug/stream", async (req, res) => {
    try {
        let stream = null;
        let vidaraErr = null;
        try {
            stream = await streamMovies(req.params.slug);
        } catch (e) {
            vidaraErr = e.message;
        }
        if (!stream || !stream.stream || stream.stream.length === 0) {
            // FALLBACK gdframe/sharer (resolver alternatif, host cepat)
            try {
                const g = await gdframeResolve(req.params.slug);
                return res.json({ status: true, developers: Developers, result: {
                    slug: req.params.slug, provider: "gdframe",
                    title: req.params.slug, poster: null,
                    hls: hlsUrl(g.hlsFinal), hls_final: g.hlsFinal
                }});
            } catch (e) {
                return res.status(404).json({ status: false, developers: Developers, message: "Movie not found (vidara: " + (vidaraErr || (stream ? "stream kosong" : "kosong") ) + " | gdframe: " + e.message + ")" });
            }
        }
        res.json({ status: true, developers: Developers, result: stream });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/search", async (req, res) => {
    try {
        const query = req.query.s;
        const page = parseInt(req.query.page) || 1;
        if (!query) return res.status(400).json({ status: false, developers: Developers, message: "Missing search query (?s=)" });

        const { results, total_pages } = await searchMovie(query, page);
        res.json({ status: true, developers: Developers, current_page: page, total_pages, results });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/movies/latest", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const { total_pages, movies } = await latestMovies(page);
        res.json({ status: true, developers: Developers, current_page: page, total_pages, results: movies });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/movies/genres", async (_, res) => {
    try {
        const genres = await getGenresMovies();
        res.json({ status: true, developers: Developers, results: genres });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/movies/years", async (_, res) => {
    try {
        const years = await getYearsMovies();
        res.json({ status: true, developers: Developers, results: years });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/movies/countries", async (_, res) => {
    try {
        const countries = await getCountriesMovies();
        res.json({ status: true, developers: Developers, results: countries });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/movies/genre/:genre", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const { total_pages, movies } = await getMovieByGenre(req.params.genre, page);
        res.json({ status: true, developers: Developers, current_page: page, total_pages, results: movies });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/movies/year/:year", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const { total_pages, movies } = await getMovieByYears(req.params.year, page);
        res.json({ status: true, developers: Developers, current_page: page, total_pages, results: movies });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/movies/country/:country", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const { total_pages, movies } = await getMovieByCountry(req.params.country, page);
        res.json({ status: true, developers: Developers, current_page: page, total_pages, results: movies });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/series/genres", async (_, res) => {
    try {
        const genres = await getGenresSeries();
        res.json({ status: true, developers: Developers, results: genres });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/series/genre/:genre", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const { total_pages, series } = await getSeriesByGenre(req.params.genre, page);
        res.json({ status: true, developers: Developers, current_page: page, total_pages, results: series });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/series/countries", async (_, res) => {
    try {
        const countries = await getCountriesSeries();
        res.json({ status: true, developers: Developers, results: countries });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/series/country/:country", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const { total_pages, series } = await getSeriesByCountry(req.params.country, page);
        res.json({ status: true, developers: Developers, current_page: page, total_pages, results: series });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/series/years", async (_, res) => {
    try {
        const years = await getYearsSeries();
        res.json({ status: true, developers: Developers, results: years });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/series/year/:year", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const { total_pages, series } = await getSeriesByYears(req.params.year, page);
        res.json({ status: true, developers: Developers, current_page: page, total_pages, results: series });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/series/:slug/stream", async (req, res) => {
    try {
        const slug = req.params.slug;
        const polaEp = /-season-(\d+)-episode-(\d+)(?:-(\d{4}))?$/i;
        const m = polaEp.exec(slug);
        if (m) {
            // slug EPISODE → resolve HLS langsung (pola sama dgn /movies/:slug/play)
            // Jalur baru: sharer.link 540.php (slug episode)
            try {
                const sh = await sharerHls(slug);
                if (sh && sh.file) {
                    warmPlayCache(sh.file); // head start: panaskan segmen sebelum player minta
                    return res.json({ status: true, developers: Developers, result: {
                        slug: slug, season: parseInt(m[1], 10), episode: parseInt(m[2], 10),
                        title: slug, poster: sh.poster || null,
                        hls: hlsUrl(sh.file), direct: sh.file
                    }});
                }
            } catch (e) { /* lanjut ke jalur lama */ }
            // Episode series (lk21asia): player muvipro AJAX -> vidara.to -> m3u8
            try {
                const ep = await episodeHls(slug);
                if (ep && ep.file) {
                    warmPlayCache(ep.file); // head start: panaskan segmen sebelum player minta
                    return res.json({ status: true, developers: Developers, result: {
                        slug: slug, season: parseInt(m[1], 10), episode: parseInt(m[2], 10),
                        title: ep.title || slug, poster: ep.poster || null,
                        hls: hlsUrl(ep.file), direct: ep.file
                    }});
                }
            } catch (e) { /* lanjut ke jalur lama */ }
            let iframe = null;
            const page = await ambil(`${process.env.LK21_BASE_SERIES}${slug}`);
            const $p = cheerio.load(page.data);
            iframe = $p("iframe#main-player").attr("src") || null;
            if (!iframe) return res.status(404).json({ status: false, developers: Developers, message: "Player episode tidak ditemukan", result: { slug, hls: null } });
            const mm = /\/iframe3\/([a-z0-9]+)\/([A-Za-z0-9_-]+)/.exec(iframe);
            if (!mm) return res.status(404).json({ status: false, developers: Developers, message: "ID player tidak terbaca" });
            const [, host, id] = mm;
            const embedRes = await fetch("https://videonode.de/api.php", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": iframe, "User-Agent": "Mozilla/5.0" },
                body: `host=${host}&id=${id}`
            });
            const embedJson = await embedRes.json();
            const embed = embedJson.embedUrl;
            if (!embed) return res.status(502).json({ status: false, developers: Developers, message: "embedUrl kosong" });
            const slug2 = new URL(embed).pathname.split("/").filter(Boolean).pop();
            const ver = await fetch("https://playcdn.de/verify/" + encodeURIComponent(slug2), { headers: { "Referer": embed, "User-Agent": "Mozilla/5.0" } });
            const verJson = await ver.json();
            if (!verJson.fileUrl) return res.status(502).json({ status: false, developers: Developers, message: "fileUrl kosong" });
            warmPlayCache(verJson.fileUrl); // head start: panaskan segmen sebelum player minta
            return res.json({ status: true, developers: Developers, result: {
                slug, season: parseInt(m[1],10), episode: parseInt(m[2],10),
                title: verJson.title, poster: verJson.poster,
                hls: hlsUrl(verJson.fileUrl), direct: verJson.fileUrl
            }});
        }
        // slug SERIES utama → info + daftar episode per season
        const detail = await getEpisode(slug);
        const episodes = [];
        for (const eps of Object.values(detail.episodes_by_season || {})) {
            for (const e of eps) episodes.push(e);
        }
        return res.json({ status: true, developers: Developers, result: {
            slug, title: detail.title, image: detail.image,
            season_count: detail.season_count,
            episodes,
            play_pattern: "/series/<slug-episode>/stream  →  result.hls"
        }});
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/series/:slug/", async (req, res) => {
    try {
        /* Cache TTL 30 menit per slug — jangan fetch ulang ke sumber
           setiap kali judul yang sama dibuka (jangan agresif ke sumber). */
        if (!global.__zonaSeriesCache) global.__zonaSeriesCache = new Map();
        const cached = global.__zonaSeriesCache.get(req.params.slug);
        if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
            return res.json({ status: true, developers: Developers, result: cached.data, cached: true });
        }
        const detail = await getEpisode(req.params.slug);
        if (!detail) {
            return res.status(404).json({ status: false, developers: Developers, message: "Series not found" });
        }
        global.__zonaSeriesCache.set(req.params.slug, { ts: Date.now(), data: detail });
        res.json({ status: true, developers: Developers, result: detail });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

// Start server
module.exports = app;
