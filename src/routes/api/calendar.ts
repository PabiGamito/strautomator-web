// Strautomator API: Calendar

import {CalendarOptions, UserData, UserCalendarTemplate, calendar, users} from "strautomator-core"
import auth from "../auth"
import dayjs from "../../dayjs"
import express = require("express")
import logger = require("anyhow")
import webserver = require("../../webserver")
const router = express.Router()
const settings = require("setmeup").settings

/**
 * Update the user calendar template.
 */
router.post("/:userId/template", async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")

        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return

        // Template is only available for PRO users.
        if (!user.isPro) {
            throw new Error("Custom calendar templates are not available on free accounts")
        }

        // Get template from body.
        const calendarTemplate: UserCalendarTemplate = {
            eventSummary: req.body.eventSummary,
            eventDetails: req.body.eventDetails
        }

        // If template is empty, force set to null.
        if (!calendarTemplate.eventSummary || calendarTemplate.eventSummary == "") {
            calendarTemplate.eventSummary = null
        }
        if (!calendarTemplate.eventDetails || calendarTemplate.eventDetails == "") {
            calendarTemplate.eventDetails = null
        }

        // Set user calendar template and save to the database.
        const data: Partial<UserData> = {
            id: user.id,
            displayName: user.displayName,
            calendarTemplate: calendarTemplate
        }
        await users.update(data)

        logger.info("Routes", req.method, req.originalUrl, "Updated template")
        webserver.renderJson(req, res, {ok: true})
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 400)
    }
})

/**
 * Return the Strava activities calendar for the specified user.
 */
router.get("/:userId/:urlToken/:calType.ics", async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")

        const user = await users.getById(req.params.userId)
        const calType = req.params.calType
        const now = dayjs().utc()

        // Validate user and URL token.
        if (!["all", "activities", "clubs"].includes(calType)) throw new Error("Calendar not found")
        if (!user) throw new Error(`User ${req.params.userId} not found`)
        if (user.urlToken != req.params.urlToken) throw new Error(`Calendar not found`)

        // Get calendar options from query parameters.
        const options: CalendarOptions = {
            activities: calType == "all" || calType == "activities",
            clubs: calType == "all" || calType == "clubs"
        }

        const getQueryDate = (value) => now.subtract(parseInt(value), "days")

        // Additional options.
        if (req.query.commutes === "0") options.excludeCommutes = true
        if (req.query.joined === "1") options.excludeNotJoined = true
        if (req.query.countries === "1") options.includeAllCountries = true
        if (req.query.sports) options.sportTypes = req.query.sports.toString().split(",")
        if (req.query.daysfrom) options.dateFrom = getQueryDate(req.query.daysfrom).startOf("day")
        if (req.query.daysto) options.dateTo = getQueryDate(req.query.daysto).endOf("day")

        // Generate and render Strava activities as an iCalendar.
        const cacheAge = user.isPro ? settings.plans.pro.calendarCacheDuration : settings.plans.free.calendarCacheDuration
        const expires = now.add(cacheAge, "seconds")

        logger.info("Routes", req.method, req.originalUrl)

        // Update cache headers and send response.
        res.setHeader("Content-Type", "text/calendar")
        res.setHeader("Cache-Control", `public, max-age=${cacheAge}`)
        res.setHeader("Expires", `${expires.format("ddd, DD MMM YYYY HH:mm:ss")} GMT`)

        // Generate the calendar.
        const redirectUrl = await calendar.generate(user, options)
        res.redirect(302, redirectUrl)
    } catch (ex) {
        if (ex.toString().includes(" not found")) {
            logger.warn("Routes", req.method, req.originalUrl, ex)
            res.status(404)
        } else {
            logger.error("Routes", req.method, req.originalUrl, ex)
            res.status(500)
        }

        return res.send(ex.toString())
    }
})

export = router
