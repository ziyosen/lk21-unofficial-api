const { fetchListings } = require("../bases");
const { wpBases, wpByYear, mergeWpMovies } = require("./wpsource");
require("dotenv").config()

async function getMovieByYears(yearsid, page = 1) {
    try{
        // Sumber WP: filter tahun TERBIT post (perkiraan, lihat wpsource.js).
        const wpPromise = (async () => {
            const bases = wpBases();
            if (!bases.length) return [];
            const settled = await Promise.allSettled(bases.map((s) => wpByYear(s.base, yearsid, page)));
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
                let url = `${base}year/${yearsid}`;
                if (page > 1){
                    url = `${base}year/${yearsid}/page/${page}/`;
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
    getMovieByYears
}
