// Strautomator Index / startup

import logger = require("anyhow")

async function start() {
    try {
        const core = require("strautomator-core")
        await core.startup()

        // Load settings.
        const setmeup = require("setmeup")
        const settings = setmeup.settings

        // Enable logging unhandled exceptions and rejections.
        logger.setOptions({uncaughtExceptions: true, unhandledRejections: true})

        // Import and Set Nuxt.js options.
        const config = require("../nuxt.config.js")
        config.dev = process.env.NODE_ENV !== "production"

        // Copy SetMeUp settings to nuxt.
        const oauthConfig = config.oauth
        oauthConfig.secretKey = settings.cookie.secret
        oauthConfig.oauthClientID = settings.strava.api.clientId
        oauthConfig.oauthClientSecret = settings.strava.api.clientSecret
        oauthConfig.scopes = [settings.strava.api.scopes]

        // Init Nuxt.js.
        const {Nuxt, Builder} = require("nuxt")
        const nuxt = new Nuxt(config)

        // Port set via the PORT environment variable?
        if (process.env.PORT) {
            logger.info("Strautomator.startup", `Port ${process.env.PORT} set via envionment variable`)
            settings.app.port = process.env.PORT
        }

        // Override nuxt configuration.
        const baseUrl = settings.app.url
        nuxt.options.head.title = settings.app.title
        nuxt.options.head.titleTemplate = `${settings.app.title} - %s`
        nuxt.options.server.host = settings.app.ip
        nuxt.options.server.port = settings.app.port
        nuxt.options.env.baseUrl = baseUrl
        nuxt.options.axios.baseURL = baseUrl
        nuxt.options.axios.browserBaseURL = baseUrl

        // Nuxt setup.
        await nuxt.ready()

        // Force build only in dev mode.
        if (config.dev) {
            const builder = new Builder(nuxt)
            await builder.build()
        }

        // Execute the tunnel file?
        if (settings.app.tunnel) {
            const {spawn} = require("child_process")
            const tunnel = spawn("./tunnel")
            tunnel.stdout.on("data", (data) => logger.info("Tunnel", data.toString()))
            tunnel.on("error", (err) => logger.error("Tunnel", err))
            tunnel.on("close", (code) => logger.warn("Tunnel", `Closed with code ${code}`))
        }

        // Start the web server.
        const webserver = require("./webserver")
        await webserver.init(nuxt.render)
    } catch (ex) {
        logger.error("Strautomator.startup", "Failed to start", ex)
        process.exit(1)
    }
}

start()
