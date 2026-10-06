const express = require("express");
const cheerio = require("cheerio");
const { ambil } = require("./scrapper/fetcher");;
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
        if (!iframe) return res.status(404).json({ status: false, message: "Player tidak ditemukan" });
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
        res.json({ status: true, title: verJson.title, poster: verJson.poster, hls: "/hls?u=" + encodeURIComponent(verJson.fileUrl) });
    } catch (err) {
        res.status(500).json({ status: false, message: err.message });
    }
});

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

app.get("/hls", async (req, res) => {
    if (!rateLimit(req, res, 900, 60000)) return;
    const u = req.query.u;
    if (!u || !/^https?:\/\//.test(u)) return res.status(400).end("bad url");
    // Anti-SSRF: hanya izinkan host video yang dipakai player (review sonnet-4.5)
    let h; try { h = new URL(u).hostname; } catch { return res.status(400).end("bad url"); }
    if (!/(^|\.)playcdn\.de$|(^|\.)qornexia\.xyz$|(^|\.)videonode\.de$/.test(h)) return res.status(403).end("host tidak diizinkan");
    try {
        const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://playcdn.de/" } });
        const ct = r.headers.get("content-type") || "";
        if (u.includes(".m3u8") || ct.includes("mpegurl")) {
            let txt = await r.text();
            const base = new URL(u);
            txt = txt.split("\n").map(line => {
                const t = line.trim();
                if (!t || t.startsWith("#")) {
                    // rewrite URI="..." di tag
                    return line.replace(/URI="([^"]+)"/g, (_, x) => 'URI="/hls?u=' + encodeURIComponent(new URL(x, base).toString()) + '"');
                }
                return "/hls?u=" + encodeURIComponent(new URL(t, base).toString());
            }).join("\n");
            res.set("Content-Type", "application/vnd.apple.mpegurl");
            res.set("Cache-Control", "no-store");
            return res.send(txt);
        }
        // segmen binary → pipe
        const upstream = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://playcdn.de/" } });
        res.set("Content-Type", upstream.headers.get("content-type") || "video/mp2t");
        res.set("Cache-Control", "public, max-age=86400");
        const reader = upstream.body.getReader();
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
        const stream = await streamMovies(req.params.slug);
        if (!stream) {
            return res.status(404).json({ status: false, developers: Developers, message: "Movie not found" });
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
        const stream = await streamSeries(req.params.slug);
        if (!stream) {
            return res.status(404).json({ status: false, developers: Developers, message: "Series not found" });
        }
        res.json({ status: true, developers: Developers, result: stream });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

app.get("/series/:slug/", async (req, res) => {
    try {
        const detail = await getEpisode(req.params.slug);
        if (!detail) {
            return res.status(404).json({ status: false, developers: Developers, message: "Series not found" });
        }
        res.json({ status: true, developers: Developers, result: detail });
    } catch (err) {
        res.status(500).json({ status: false, developers: Developers, message: err.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server is running on http://localhost:${PORT}`);
});
