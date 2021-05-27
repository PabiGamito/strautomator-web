import Vue from "vue"

Vue.prototype.$webError = async (method, ex) => {
    try {
        const responseData = ex.response ? ex.response.data : null
        let status = responseData ? responseData.status || responseData.statusCode : ex.status || ex.statusCode

        // Status defaults to 500.
        if (!status) status = 500

        // Get error message.
        let message = responseData ? responseData.message : ex.message
        if (!message) message = ex.toString()

        // Get error title.
        let title = responseData ? responseData.reason : ex.title
        if (!title) title = ""

        // Running on the server or the client?
        if (process.server) {
            const logger = require("anyhow")
            logger.error("Vue", method, `Status ${status}`, `${title || "Error"} - ${message}`)
        } else {
            try {
                if (this.$ga) this.$ga.exception(message)
            } catch (gaEx) {
                console.error(gaEx)
            }

            document.location.href = `/error?status=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}&title=${encodeURIComponent(title)}`
        }
    } catch (innerEx) {
        console.error("Vue.webError", ex, innerEx)
    }
}
