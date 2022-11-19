// Strautomator API: Weather

import {weather, UserData, WeatherSummary} from "strautomator-core"
import auth from "../auth"
import express = require("express")
import logger = require("anyhow")
import webserver = require("../../webserver")
import dayjs from "dayjs"
const settings = require("setmeup").settings
const router = express.Router()

// Multi forecast result.
interface MultiForecastResult {
    coordinates?: [number, number]
    timestamp?: number
    forecast?: WeatherSummary
    error?: Error
}

/**
 * Weather for the specified coordinates.
 */
router.get("/:userId/coordinates/:coordinates/:timeoffset", async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")

        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return

        if (!req.params.coordinates) {
            logger.error("Routes", req.method, req.originalUrl, "Missing coordinates")
            return webserver.renderError(req, res, "Missing coordinates", 400)
        }

        const result = {}
        const now = dayjs().utcOffset(parseInt(req.params.timeoffset))
        const coordinates = req.params.coordinates.toString()

        for (let provider of weather.providers) {
            try {
                const summary = await provider.getWeather(coordinates.split(","), now, user.preferences)
                result[provider.name] = summary
            } catch (innerEx) {
                logger.error("Routes", req.method, req.originalUrl, `Provider: ${provider.name}`, innerEx)
            }
        }

        logger.info("Routes", req.method, req.originalUrl)
        res.set("Cache-Control", "public, max-age=300")
        webserver.renderJson(req, res, result)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        res.status(500).json({error: ex.toString()})
    }
})

/**
 * Weather forecast for the specified locations and dates, using the "data" query with the
 * following format: "id:lat,long:timestamp|id:lat,long:timestamp|id:lat,long:timestamp|[...]"
 */
router.get("/:userId/multi-forecast", async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")

        const user: UserData = (await auth.requestValidator(req, res, {referer: true})) as UserData
        if (!user) return

        if (!req.query.data) {
            logger.error("Routes", req.method, req.originalUrl, "Missing request query")
            return webserver.renderError(req, res, "Missing request query", 400)
        }

        const arrQuery = req.query.data.toString().split("|")
        const result: MultiForecastResult[] = []
        let hadError = false

        // Helper to get a single forecast.
        const getForecast = async (query): Promise<void> => {
            let queryResult: MultiForecastResult = {}
            try {
                const arrData = query.split(":")
                queryResult.coordinates = arrData[1].split(",").map((c) => parseFloat(c)) as [number, number]
                queryResult.timestamp = parseInt(arrData[2])
                queryResult.forecast = await weather.getLocationWeather(user, queryResult.coordinates, dayjs.unix(queryResult.timestamp))
            } catch (weatherEx) {
                logger.warn("Routes", req.method, req.path, query, weatherEx.message)
                hadError = true
                queryResult.error = weatherEx
            } finally {
                result.push(queryResult)
            }
        }

        // Get forecasts in parallel.
        const batchSize = user.isPro ? settings.plans.pro.apiConcurrency : settings.plans.free.apiConcurrency
        while (arrQuery.length) {
            await Promise.all(arrQuery.splice(0, batchSize).map(getForecast))
        }

        logger.info("Routes", req.method, req.originalUrl)
        res.set("Cache-Control", `public, max-age=${hadError ? "60" : "600"}`)
        webserver.renderJson(req, res, result)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        res.status(500).json({error: ex.toString()})
    }
})

export = router
