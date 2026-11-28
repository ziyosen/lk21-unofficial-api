const { fetchListings, isPrimaryBase } = require("../bases");
const { wpBases, wpByCategory, mergeWpMovies } = require("./wpsource");
require("dotenv").config()

async function getMovieByGenre(genreid, page = 1){
    const GENRE_ID = { action: 'aksi', adventure: 'petualangan', 'action-adventure': 'aksi-petualangan', animation: 'animasi', comedy: 'komedi', crime: 'kejahatan', documentary: 'dokumenter', drama: 'drama', family: 'keluarga', fantasy: 'fantasi', history: 'sejarah', horror: 'kengerian', music: 'musik', mystery: 'misteri', romance: 'percintaan', 'sci-fi': 'sci-fi-fantasy', 'science-fiction': 'sci-fi-fantasy', thriller: 'cerita-seru', war: 'war', 'tv-movie': 'film-tv' };
    try{
        const idSlug = GENRE_ID[(genreid || '').toLowerCase()] || genreid;
        const enSlug = (genreid || '').toLowerCase();
        // lk21asia pakai slug kategori Indonesia (/category/aksi/),
        // layarkaca21.city pakai slug Inggris (/category/action/).
        // Sumber WP (lk21official + idlix) pakai slug Inggris via wp-json.
        const wpPromise = (async () => {
            const bases = wpBases();
            if (!bases.length) return [];
            const settled = await Promise.allSettled(bases.map((s) => wpByCategory(s.base, enSlug, page)));
            let merged = [];
            settled.forEach((r, i) => {
                if (r.status === "fulfilled" && r.value && r.value.movies) {
                    merged = mergeWpMovies(merged, r.value.movies, bases[i].name);
                }
            });
            return merged;
        })();
        let baseRes;
        try {
            baseRes = await fetchListings((base) => {
                const slug = isPrimaryBase(base) ? idSlug : enSlug;
                let url = `${base}category/${slug}/`;
                if (page > 1){
                    url = `${base}category/${slug}/page/${page}/`;
                }
                return url;
            });
        } catch (e) {
            const wpMovies = await wpPromise;
            if (wpMovies.length) return { total_pages: 1, movies: wpMovies };
            throw e;
        }
        const wpMovies = await wpPromise;
        return {
            total_pages: baseRes.total_pages,
            movies: mergeWpMovies(baseRes.movies, wpMovies)
        };

    } catch(err){
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = {
    getMovieByGenre,
}
