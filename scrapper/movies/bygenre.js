const { fetchListings, isPrimaryBase } = require("../bases");
require("dotenv").config()

async function getMovieByGenre(genreid, page = 1){
    const GENRE_ID = { action: 'aksi', adventure: 'petualangan', 'action-adventure': 'aksi-petualangan', animation: 'animasi', comedy: 'komedi', crime: 'kejahatan', documentary: 'dokumenter', drama: 'drama', family: 'keluarga', fantasy: 'fantasi', history: 'sejarah', horror: 'kengerian', music: 'musik', mystery: 'misteri', romance: 'percintaan', 'sci-fi': 'sci-fi-fantasy', 'science-fiction': 'sci-fi-fantasy', thriller: 'cerita-seru', war: 'war', 'tv-movie': 'film-tv' };
    try{
        const idSlug = GENRE_ID[(genreid || '').toLowerCase()] || genreid;
        const enSlug = (genreid || '').toLowerCase();
        // lk21asia pakai slug kategori Indonesia (/category/aksi/),
        // layarkaca21.city pakai slug Inggris (/category/action/).
        const { total_pages, movies } = await fetchListings((base) => {
            const slug = isPrimaryBase(base) ? idSlug : enSlug;
            let url = `${base}category/${slug}/`;
            if (page > 1){
                url = `${base}category/${slug}/page/${page}/`;
            }
            return url;
        });
        return {
            total_pages,
            movies
        };

    } catch(err){
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = {
    getMovieByGenre,
}
