const { fetchListings } = require("../bases");
require("dotenv").config()

async function latestMovies(page = 1) {
    try {
        // Patch lokal (dipertahankan): halaman 1 = homepage (/latest/ 404 di
        // kedua base), halaman > 1 = /page/N/. Berlaku untuk kedua base.
        return await fetchListings((base) => {
            let url = `${base}`;
            if (page > 1) {
                url = `${base}page/${page}/`;
            }
            return url;
        });
    } catch (err) {
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = { latestMovies }
