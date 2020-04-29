// Strautomator Index / startup

import logger = require("anyhow")

async function start() {
    try {
        const core = require("strautomator-core")
        await core.startup()

        // Load settings.
        const setmeup = require("setmeup")
        const settings = setmeup.settings

        // Import and Set Nuxt.js options.
        const config = require("../nuxt.config.js")
        config.dev = process.env.NODE_ENV !== "production"

        // Init Nuxt.js.
        const {Nuxt, Builder} = require("nuxt")
        const nuxt = new Nuxt(config)

        // Port set via the PORN eenvironment variable?
        if (process.env.PORT) {
            logger.info("Strautomator.startup", `Port ${process.env.PORT} set via envionment variable`)
            settings.app.port = process.env.PORT
            nuxt.options.server.port = settings.app.port
        }

        // Nuxt setup.
        await nuxt.ready()

        // Force build only in dev mode.
        if (config.dev) {
            const builder = new Builder(nuxt)
            await builder.build()
        }

        // Start the web server.
        const webserver = require("./webserver")
        await webserver.init(nuxt.render)

        // Gracefully shutdown.
        process.on("SIGTERM", async () => {
            await core.shutdown()
        })
    } catch (ex) {
        logger.error("Strautomator.startup", "Failed to start", ex)
        process.exit(1)
    }
}

start()
