const { fetchListings } = require("../bases");
require("dotenv").config()

async function getMovieByCountry(countryid, page = 1) {
    try{
        const { total_pages, movies } = await fetchListings((base) => {
            let url = `${base}country/${countryid}`;
            if (page > 1){
                url = `${base}country/${countryid}/page/${page}/`;
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
    getMovieByCountry
}
