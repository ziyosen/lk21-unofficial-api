// wpsource.js — sumber film WordPress via wp-json (lk21official.cloud +
// idlix.bar), sebagai sumber ke-3/ke-4 Zona Cinema (28 Nov 2026).
// Dipakai listing/search/genre/year. Poster diambil dari featured media
// (batch /wp/v2/media), genre dari nama kategori (batch /wp/v2/categories).
//
// PLAYBACK TIDAK di sini:
// - lk21official: SUDAH jalan lewat rantai /play existing (sharer.link
//   540.php + gdframe — player situs ini memang sharer.link). Terbukti
//   10/10 slug terbaru OK tanpa kode baru.
// - idlix: TIDAK ada resolver. Satu-satunya embed (chillx.top) adalah
//   halaman parkir ParkLogic (router mengembalikan landing page parkir,
//   bukan video); tidak ada voe/server lain di halaman detail. /play
//   untuk judul idlix-only akan 404 seperti judul tanpa player lainnya.
"use strict";
const { ambil } = require("../fetcher");

function wpBases() {
    const defs = [
        { name: "lk21official", env: "LK21_BASE_MOVIE_3" },
        { name: "idlix", env: "LK21_BASE_MOVIE_4" },
    ];
    const out = [];
    for (const d of defs) {
        let b = (process.env[d.env] || "").trim();
        if (!b) continue;
        if (!b.endsWith("/")) b += "/";
        out.push({ name: d.name, base: b });
    }
    return out;
}

// Slug kategori yang dikenali sebagai genre (untuk memilih nama genre yang
// ditampilkan; kategori junk seperti 'bioskop168' dilewati).
const GENRE_SLUGS = new Set([
    "action", "action-adventure", "adventure", "animation", "biography",
    "comedy", "crime", "documentary", "drama", "family", "fantasy",
    "film-noir", "foreign", "game-show", "history", "horror", "music",
    "musical", "mystery", "news", "reality-tv", "romance", "school",
    "sci-fi", "science-fiction", "semi", "short", "thriller", "tv-movie",
    "war", "adult", "erotic",
]);
// Kategori yang menandai post sebagai series (bukan film).
const SERIES_CAT_SLUGS = new Set([
    "tv-series", "tv", "series", "tv-shows", "drama-korea", "drakor", "k-drama",
]);

async function wpGetJson(url) {
    const resp = await ambil(url);
    return JSON.parse(resp.data);
}

function stripHtml(s) {
    return String(s || "")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#0*39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, " ")
        .trim();
}

// Cache nama kategori per base+id (kategori jarang berubah; service restart
// berkala membersihkan cache ini).
const _catCache = new Map(); // base -> Map(id -> {slug,name} | null)
async function wpCategoryMap(base, ids) {
    const uniq = [...new Set((ids || []).filter((x) => Number.isInteger(x) && x > 0))];
    if (!uniq.length) return new Map();
    let perBase = _catCache.get(base);
    if (!perBase) { perBase = new Map(); _catCache.set(base, perBase); }
    const missing = uniq.filter((id) => !perBase.has(id));
    if (missing.length) {
        try {
            const rows = await wpGetJson(`${base}wp-json/wp/v2/categories?include=${missing.join(",")}&per_page=100&_fields=id,slug,name`);
            for (const c of rows || []) perBase.set(c.id, { slug: c.slug, name: c.name });
        } catch (e) { /* kategori opsional */ }
        for (const id of missing) if (!perBase.has(id)) perBase.set(id, null);
    }
    const out = new Map();
    for (const id of uniq) if (perBase.get(id)) out.set(id, perBase.get(id));
    return out;
}

// Batch featured media -> map id -> URL poster. Pilih thumbnail terkecil
// yang lebarnya >= 150 (hemat bandwidth, cukup untuk kartu 158px);
// kalau tidak ada, pakai source_url.
async function wpMediaMap(base, ids) {
    const uniq = [...new Set((ids || []).filter((x) => Number.isInteger(x) && x > 0))];
    if (!uniq.length) return new Map();
    const out = new Map();
    try {
        const rows = await wpGetJson(`${base}wp-json/wp/v2/media?include=${uniq.join(",")}&per_page=100&_fields=id,source_url,media_details`);
        for (const m of rows || []) {
            const sizes = ((m.media_details || {}).sizes) || {};
            let best = null, bestW = Infinity;
            for (const s of Object.values(sizes)) {
                const w = s.width || 0;
                if (w >= 150 && w < bestW && s.source_url) { best = s.source_url; bestW = w; }
            }
            out.set(m.id, best || m.source_url || null);
        }
    } catch (e) { /* poster opsional */ }
    return out;
}

function wpPostToMovie(post, mediaMap, catMap) {
    const title = stripHtml((post.title && post.title.rendered) || "");
    const slug = post.slug || "";
    const ym = title.match(/\((\d{4})\)/) || slug.match(/-(\d{4})$/);
    const year = ym && ym[1] ? ym[1] : "";
    let genre = "N/A";
    let is_series = false;
    const cats = (post.categories || []).map((id) => catMap.get(id)).filter(Boolean);
    for (const c of cats) {
        if (SERIES_CAT_SLUGS.has((c.slug || "").toLowerCase())) is_series = true;
    }
    if (/season/i.test(title)) is_series = true;
    const g = cats.find((c) => GENRE_SLUGS.has((c.slug || "").toLowerCase()));
    if (g) genre = g.name || g.slug;
    else if (cats.length) genre = cats[0].name || cats[0].slug || "N/A";
    const images = (post.featured_media && mediaMap.get(post.featured_media)) || null;
    return {
        slug, title, year,
        rating: "N/A", quality: "N/A", duration: "N/A",
        genre, images, is_series,
    };
}

// Ambil daftar post WP + lengkapi poster + genre. params = query string
// (tanpa '?') untuk /wp-json/wp/v2/posts. Mengembalikan { movies }.
async function wpList(base, params) {
    const posts = await wpGetJson(`${base}wp-json/wp/v2/posts?${params}`);
    if (!Array.isArray(posts) || !posts.length) return { movies: [] };
    const mediaIds = posts.map((p) => p.featured_media).filter((x) => x);
    const catIds = posts.flatMap((p) => p.categories || []);
    const [mediaMap, catMap] = await Promise.all([
        wpMediaMap(base, mediaIds),
        wpCategoryMap(base, catIds),
    ]);
    const movies = [];
    for (const p of posts) {
        if (!p.slug) continue;
        movies.push(wpPostToMovie(p, mediaMap, catMap));
    }
    return { movies };
}

const LIGHT_FIELDS = "_fields=slug,title,featured_media,categories,date";

async function wpLatest(base, page = 1) {
    return wpList(base, `per_page=100&page=${page}&orderby=date&order=desc&${LIGHT_FIELDS}`);
}

async function wpSearch(base, q, page = 1) {
    return wpList(base, `search=${encodeURIComponent(q)}&per_page=100&page=${page}&orderby=relevance&${LIGHT_FIELDS}`);
}

// Cache id kategori per base+slug.
const _catSlugCache = new Map(); // "base|slug" -> id|null
async function wpCategoryIdBySlug(base, slug) {
    const key = base + "|" + slug;
    if (_catSlugCache.has(key)) return _catSlugCache.get(key);
    let id = null;
    try {
        const rows = await wpGetJson(`${base}wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}&_fields=id,slug`);
        if (rows && rows.length) id = rows[0].id;
    } catch (e) { /* kategori tidak ada */ }
    _catSlugCache.set(key, id);
    return id;
}

async function wpByCategory(base, catSlug, page = 1) {
    const id = await wpCategoryIdBySlug(base, catSlug);
    if (!id) return { movies: [] };
    return wpList(base, `categories=${id}&per_page=100&page=${page}&orderby=date&order=desc&${LIGHT_FIELDS}`);
}

// Tahun TERBIT post (bukan tahun rilis film): sebagian besar film baru
// terbit di tahun rilisnya, tapi film lama yang baru diunggah bisa masuk
// tahun yang salah. Ini perkiraan, bukan filter tahun rilis yang presisi.
async function wpByYear(base, year, page = 1) {
    const y = parseInt(year, 10);
    if (!y) return { movies: [] };
    return wpList(base, `after=${y}-01-01T00:00:00&before=${y + 1}-01-01T00:00:00&per_page=100&page=${page}&orderby=date&order=desc&${LIGHT_FIELDS}`);
}

// Gabung hasil WP ke daftar yang sudah ada. Dedup: slug + judul
// (normalisasi) yang sama = satu judul; slug sama tapi judul beda =
// dipertahankan keduanya. Menandai asal sumber di field `source`.
function mergeWpMovies(existing, wpMovies, sourceName) {
    const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const seen = new Set((existing || []).map((m) => `${m.slug || ""}|${norm(m.title)}`));
    const out = (existing || []).slice();
    for (const m of wpMovies || []) {
        if (!m.slug || m.slug === "N/A") continue;
        const key = `${m.slug}|${norm(m.title)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Pertahankan `source` yang sudah diset pemanggil (wpAllLatest dkk
        // memberi nama sumber per-base); hanya isi dari sourceName kalau
        // item belum punya. (Bug awal: sourceName undefined menimpa
        // `source` yang sudah ada -> hilang di JSON.)
        const item = { ...m };
        if (item.source || sourceName) item.source = item.source || sourceName;
        out.push(item);
    }
    return out;
}

module.exports = {
    wpBases, wpLatest, wpSearch, wpByCategory, wpByYear, mergeWpMovies,
};
