const { fetchListings } = require("../bases");
require("dotenv").config()

async function getMovieByYears(yearsid, page = 1) {
    try{
        const { total_pages, movies } = await fetchListings((base) => {
            let url = `${base}year/${yearsid}`;
            if (page > 1){
                url = `${base}year/${yearsid}/page/${page}/`;
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
    getMovieByYears
}
