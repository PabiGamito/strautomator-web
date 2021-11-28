// Strautomator API: Strava routes

import {database, strava, users, UserData, StravaAthleteRecords, StravaSport, getActivityFortune} from "strautomator-core"
import auth from "../auth"
import dayjs from "../../dayjs"
import _ = require("lodash")
import express = require("express")
import jaul = require("jaul")
import logger = require("anyhow")
import webserver = require("../../webserver")
const axios = require("axios").default
const settings = require("setmeup").settings
const router = express.Router()
const packageVersion = require("../../../package.json").version

/**
 * Cache list of ignored users.
 */
const ignoredUsers: string[] = []
database.appState.get("users").then((data) => (data && data.ignored ? ignoredUsers.push.apply(ignoredUsers, data.ignored) : null))

/**
 * Helper to validate incoming webhook events sent by Strava.
 */
const webhookValidator = (req: express.Request, res: express.Response): boolean => {
    try {
        const obj = req.body
        const method = req.method.toUpperCase()

        // Then we check if any data is missing.
        if (method == "POST") {
            if (!obj.aspect_type || !obj.event_time || !obj.object_id || !obj.object_type) {
                logger.error("Routes", req.method, req.originalUrl, "Missing event data", obj)
                webserver.renderError(req, res, "Missing event data", 400)
                return false
            }

            // User has deauthorized Strautomator?
            if (obj.object_type == "athlete" && obj.updates && obj.updates.authorized == "false") {
                strava.athletes.deauthCheck(obj.owner_id.toString())
                logger.debug("Routes", req.method, req.originalUrl, `User ${obj.owner_id}`, obj.aspect_type, obj.object_type, obj.object_id, "Deauthorized")
                webserver.renderJson(req, res, {authorized: false})
                return false
            }

            // Only want to process new activities, so skip the rest.
            if (obj.aspect_type != "create" || obj.object_type != "activity") {
                logger.debug("Routes", req.method, req.originalUrl, `User ${obj.owner_id}`, obj.aspect_type, obj.object_type, obj.object_id, "Skipped")
                webserver.renderJson(req, res, {ok: false})
                return false
            }
        }
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderJson(req, res, {error: ex.toString()})
        return false
    }

    return true
}

// ACTIVITIES AND RECORDS
// --------------------------------------------------------------------------

/**
 * Get logged user's recent activities from Strava.
 * By default, return only 10 results.
 */
router.get("/:userId/activities/recent", async (req: express.Request, res: express.Response) => {
    try {
        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return

        // Limit number of recent activites, with a hard coded maximum of 50.
        let limit: number = req.query.limit ? parseInt(req.query.limit as string) : 10
        if (limit > 50) limit = 50

        // Get activities for the past 21 days by default, with a hard limit of 30 days.
        let timestamp = req.query.since ? dayjs.unix(parseInt(req.query.since as string)) : dayjs().subtract(21, "days")
        let minTimestamp = dayjs().subtract(30, "days")
        if (timestamp.isBefore(minTimestamp)) timestamp = minTimestamp

        // Fetch recent activities.
        let activities = await strava.activities.getActivities(user, {after: timestamp.unix()})

        // Recent activities should come first, so we reverse the array.
        activities.reverse()

        // Do not pass the limit.
        if (activities.length > limit) {
            activities = activities.slice(0, limit)
        }

        logger.info("Routes", req.method, req.originalUrl)
        webserver.renderJson(req, res, activities)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

/**
 * Get logged user's activities from Strava since the specified timestamp.
 * Maximum of 2 years.
 */
router.get("/:userId/activities/since/:timestamp", async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")

        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return

        // Timestamp is mandatory.
        if (!req.params.timestamp) {
            throw new Error("Missing timestamp")
        }

        // Hard limit of 2 years on the minimum timestamp.
        let timestamp = dayjs.unix(parseInt(req.params.timestamp as string))
        let minTimestamp = dayjs().subtract(731, "days")
        if (timestamp.isBefore(minTimestamp)) timestamp = minTimestamp

        // Fetch activities since the specified timestamp.
        let activities = await strava.activities.getActivities(user, {after: timestamp.unix()})

        // If a gear filter was passed, remove activities that are not for that particular gear.
        if (req.query.gear) {
            _.remove(activities, (a) => !a.gear || a.gear.id != req.query.gear)
        }

        logger.info("Routes", req.method, req.originalUrl, `Got ${activities.length} activites`)
        webserver.renderJson(req, res, activities)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

/**
 * Get logged user's latest activities that were processed by Strautomator.
 */
router.get("/:userId/activities/processed", async (req: express.Request, res: express.Response) => {
    try {
        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return

        // Limit number of activites returned?
        let limit: number = req.query.limit ? parseInt(req.query.limit as string) : null
        let dateFrom: Date = req.query.from ? dayjs(req.query.from.toString()).toDate() : null
        let dateTo: Date = req.query.to ? dayjs(req.query.to.toString()).toDate() : null

        const activities = await strava.activities.getProcessedActivites(user, dateFrom, dateTo, limit)

        logger.info("Routes", req.method, req.originalUrl)
        webserver.renderJson(req, res, activities)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

/**
 * Get the details for the specified activity.
 */
router.get("/:userId/activities/:id/details", async (req: express.Request, res: express.Response) => {
    try {
        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return
        if (!req.params.id) throw new Error("Missing activity ID")

        const activity = await strava.activities.getActivity(user, req.params.id.toString())

        logger.info("Routes", req.method, req.originalUrl)
        webserver.renderJson(req, res, activity)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        const errorMessage = ex.toString().toLowerCase()
        const status = errorMessage.indexOf("not found") > 0 ? 404 : 500
        webserver.renderError(req, res, {error: errorMessage}, status)
    }
})

/**
 * Logged user can trigger a forced processing of a particular activity.
 */
router.get("/:userId/process-activity/:activityId", async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")

        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return

        // Process the passed activity.
        const processedActivity = await strava.activities.processActivity(user, parseInt(req.params.activityId))
        webserver.renderJson(req, res, processedActivity || {processed: false})
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        const errorMessage = ex.toString()
        const status = errorMessage.indexOf("not found") > 0 ? 404 : 500
        webserver.renderError(req, res, {error: errorMessage}, status)
    }
})

/**
 * Get athlete's personal records.
 */
router.get("/:userId/athlete-records", async (req: express.Request, res: express.Response) => {
    try {
        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return

        const records = await strava.athletes.getAthleteRecords(user)
        webserver.renderJson(req, res, records)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

/**
 * Prepar and refresh athlete's personal records based on all Strava activities.
 */
router.get("/:userId/athlete-records/refresh", async (req: express.Request, res: express.Response) => {
    try {
        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return

        const existing = await strava.athletes.getAthleteRecords(user)

        if (existing) {
            logger.warn("Routes", req.method, req.originalUrl, `Recently refreshed, will not proceed`)
            webserver.renderJson(req, res, {recentlyRefreshed: true})
        }

        // First we prepare the baseline.
        await strava.athletes.prepareAthleteRecords(user)

        const tsAfter = new Date("2000-01-01").valueOf() / 1000
        const tsBefore = new Date().valueOf() / 1000

        // Now get all user activities and check their records.
        const activities = await strava.activities.getActivities(user, {before: tsBefore, after: tsAfter})
        const records = await strava.athletes.checkActivityRecords(user, activities)

        webserver.renderJson(req, res, records)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

/**
 * Update an athlete record manually.
 */
router.post("/:userId/athlete-records/:sport", async (req: express.Request, res: express.Response) => {
    try {
        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return
        if (!req.body) throw new Error("Missing request body")

        // Record parameters.
        const sportsList = Object.keys(StravaSport)
        const sport = req.params.sport
        const field = req.body.field
        const value = req.body.value
        const previous = req.body.previous

        // Validate request body.
        if (!field) throw new Error("Missing record field")
        if (!value || isNaN(value)) throw new Error("Missing or invalid record value")
        if (!sportsList.includes(sport)) throw new Error("Invalid sport")

        // Update record and save to the database.
        const records: StravaAthleteRecords = {
            [sport]: {
                [field]: {
                    value: parseFloat(value),
                    activityId: null,
                    date: new Date()
                }
            }
        }

        // Also update the previous value?
        if (previous && !isNaN(previous)) {
            records[sport][field].previous = previous
        }

        await strava.athletes.setAthleteRecords(user, records)
        webserver.renderJson(req, res, records)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

// FORTUNE
// --------------------------------------------------------------------------

/**
 * Get the fortune (auto generated name or quote) for the specified activity details.
 */
router.post("/:userId/activity-fortune", async (req: express.Request, res: express.Response) => {
    try {
        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return
        if (!req.body || Object.keys(req.body).length == 0) throw new Error("Missing activity details")

        // Activity dates must be transformed.
        const activity = req.body
        if (activity.dateStart) activity.dateStart = new Date(activity.dateStart)
        if (activity.dateEnd) activity.dateEnd = new Date(activity.dateEnd)

        const name = await getActivityFortune(user, activity)

        logger.info("Routes", req.method, req.originalUrl, `Activity ${req.body.id}`)
        webserver.renderJson(req, res, {name: name})
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 400)
    }
})

// FTP ESTIMATOR
// --------------------------------------------------------------------------

/**
 * Get estimated FTP based on activities during the past weeks.
 */
router.get("/:userId/ftp/estimate", async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")

        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return

        // Weeks passed as a parameter?
        const weeks: number = req.query.weeks ? parseInt(req.query.weeks as any) : null

        // Estimate the athlete's FTP.
        const data = await strava.activities.ftpFromActivities(user, weeks)
        webserver.renderJson(req, res, data || false)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

/**
 * Update the user's FTP on Strava.
 */
router.post("/:userId/ftp/estimate", async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")

        const user: UserData = (await auth.requestValidator(req, res)) as UserData
        if (!user) return

        let ftp = req.body && req.body.ftp ? parseInt(req.body.ftp) : null

        // Calculate the estimated FTP, if no value was passed.
        if (!ftp) {
            const data = await strava.activities.ftpFromActivities(user)
            ftp = data.ftpWatts
        }

        // Update the user's FTP.
        const updated = await strava.athletes.setAthleteFtp(user, ftp)
        const result = updated ? {ftp: ftp} : false
        webserver.renderJson(req, res, result)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

// WEBHOOKS
// --------------------------------------------------------------------------

/**
 * Activity subscription events sent by Strava. Please note that this route will
 * mostly return OK 200, unless the verification token is invalid.
 */
router.get(`/webhook/${settings.strava.api.urlToken}`, async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")

        const challenge = req.query["hub.challenge"] as string
        const verifyToken = req.query["hub.verify_token"] as string
        const clientIP = jaul.network.getClientIP(req)

        // Validate token from Strava.
        if (verifyToken != settings.strava.api.verifyToken) {
            logger.error("Routes", req.method, req.originalUrl, "Invalid verify_token")
            return webserver.renderError(req, res, "Invalid token", 401)
        }

        // Validate challenge from Strava.
        if (!challenge || challenge == "") {
            logger.error("Routes", req.method, req.originalUrl, "Missing hub challenge")
            return webserver.renderError(req, res, "Missing hub challenge", 401)
        }

        // Echo hub challenge back to Strava.
        webserver.renderJson(req, res, {"hub.challenge": challenge})
        logger.info("Routes", `Subscription challenge by Strava: ${challenge}`, `IP ${clientIP}`)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
    }
})

/**
 * Activity subscription events sent by Strava. Please note that this route will
 * mostly return OK 200, unless the URL token or POST data is invalid.
 */
router.post(`/webhook/${settings.strava.api.urlToken}`, async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params || !req.body) throw new Error("Missing request params")
        if (!webhookValidator(req, res)) return

        const obj = req.body

        // Stop here if user is ignored.
        if (ignoredUsers.includes(obj.owner_id.toString())) {
            logger.warn("Routes", req.method, req.originalUrl, `User ${obj.owner_id} is ignored, won't proceed`, obj.aspect_type, obj.object_type, obj.object_id)
            return webserver.renderJson(req, res, {ok: false})
        }

        logger.info("Routes", req.method, req.originalUrl, `User ${obj.owner_id}`, obj.aspect_type, obj.object_type, obj.object_id)

        // Make a call back to the API to do the actual activity processing, so we can return
        // the response right now to Strava (within the 2 seconds max).
        const options = {
            method: "GET",
            baseURL: settings.api.url || `${settings.app.url}api/`,
            url: `/strava/webhook/${settings.strava.api.urlToken}/${obj.owner_id}/${obj.object_id}`,
            headers: {"User-Agent": `${settings.app.title} / ${packageVersion}`}
        }
        axios(options).catch((err) => logger.debug("Routes", req.method, req.originalUrl, "Callback failed", err.toString()))

        webserver.renderJson(req, res, {ok: true})
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderJson(req, res, {error: ex.toString()})
    }
})

/**
 * Called by the route above, this will effectively process the activity sent by Strava.
 */
router.get(`/webhook/${settings.strava.api.urlToken}/:userId/:activityId`, async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")
        if (!webhookValidator(req, res)) return

        const now = dayjs.utc().toDate()
        const userId = req.params.userId
        const user = await users.getById(userId)

        // User not found, suspended or missing tokens? Stop here.
        if (!user) {
            ignoredUsers.push(userId.toString())
            await database.appState.set("users", {ignored: ignoredUsers})
            logger.warn("Routes", req.method, req.originalUrl, `User ${userId} not found, added to list of ignored users`)
            return webserver.renderError(req, res, "User not found", 404)
        } else if (!user.stravaTokens || (!user.stravaTokens.accessToken && !user.stravaTokens.refreshToken)) {
            logger.warn("Routes", req.method, req.originalUrl, `User ${user.id} has no access tokens`)
            return webserver.renderError(req, res, "User has no access tokens", 400)
        } else if (user.suspended) {
            return webserver.renderJson(req, res, {ok: false, message: `User ${user.id} is suspended`})
        }

        user.dateLastActivity = now

        // Process the passed activity now, or queue later, depending on user preferences.
        if (user.preferences.delayedProcessing) {
            await strava.activities.queueActivity(user, parseInt(req.params.activityId))
            user.dateLastProcessedActivity = now
        } else {
            const processed = await strava.activities.processActivity(user, parseInt(req.params.activityId))
            if (processed && !processed.error) user.dateLastProcessedActivity = now
        }

        // Update user.
        const updatedUser = {id: user.id, displayName: user.displayName, dateLastActivity: user.dateLastActivity, dateLastProcessedActivity: user.dateLastProcessedActivity}
        await users.update(updatedUser)

        // Check if there are activities on the queue waiting to be processed.
        strava.activities.checkQueuedActivities()

        webserver.renderJson(req, res, {ok: true})
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderJson(req, res, {error: ex.toString()})
    }
})

/**
 * Process queued activities (delayed processing).
 */
router.get(`/webhook/${settings.strava.api.urlToken}/process-activity-queue`, async (req: express.Request, res: express.Response) => {
    try {
        if (!req.params) throw new Error("Missing request params")

        await strava.activities.processQueuedActivities()
        webserver.renderJson(req, res, {ok: true})
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderJson(req, res, {error: ex.toString()})
    }
})

export = router
