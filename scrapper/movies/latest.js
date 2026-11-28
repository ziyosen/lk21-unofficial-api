const { fetchListings } = require("../bases");
const { wpBases, wpLatest, mergeWpMovies } = require("./wpsource");
require("dotenv").config()

/* Sumber WP (lk21official + idlix) via wp-json — paralel, best-effort. */
async function wpAllLatest(page) {
    const bases = wpBases();
    if (!bases.length) return [];
    const settled = await Promise.allSettled(bases.map((s) => wpLatest(s.base, page)));
    let merged = [];
    settled.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value && r.value.movies) {
            merged = mergeWpMovies(merged, r.value.movies, bases[i].name);
        }
    });
    return merged;
}

async function latestMovies(page = 1) {
    try {
        // Patch lokal (dipertahankan): halaman 1 = homepage (/latest/ 404 di
        // kedua base), halaman > 1 = /page/N/. Berlaku untuk kedua base.
        const wpPromise = wpAllLatest(page);
        let baseRes;
        try {
            baseRes = await fetchListings((base) => {
                let url = `${base}`;
                if (page > 1) {
                    url = `${base}page/${page}/`;
                }
                return url;
            });
        } catch (e) {
            // Base HTML gagal semua — fallback ke hasil WP kalau ada.
            const wpMovies = await wpPromise;
            if (wpMovies.length) return { total_pages: 1, movies: wpMovies };
            throw e;
        }
        const wpMovies = await wpPromise;
        return { total_pages: baseRes.total_pages, movies: mergeWpMovies(baseRes.movies, wpMovies) };
    } catch (err) {
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = { latestMovies }
