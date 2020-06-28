// Strautomator API: User routes

import {gearwear, paypal, recipes, users, weather, RecipeData, RecipeStats, UserData, UserPreferences} from "strautomator-core"
import auth from "../auth"
import _ = require("lodash")
import express = require("express")
import moment = require("moment")
import logger = require("anyhow")
import webserver = require("../../webserver")
const router = express.Router()
const settings = require("setmeup").settings

// USER DATA
// --------------------------------------------------------------------------

/**
 * Get user by ID.
 */
router.get("/:userId", async (req, res) => {
    try {
        const userId = req.params.userId
        const user: UserData = (await auth.requestValidator(req, res, {userId: userId})) as UserData
        if (!user) return

        logger.info("Routes", req.method, req.originalUrl)
        webserver.renderJson(req, res, user)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

/**
 * Get subscription details for the passed user.
 */
router.get("/:userId/subscription", async (req, res) => {
    try {
        const userId = req.params.userId
        const user: UserData = (await auth.requestValidator(req, res, {userId: userId})) as UserData
        if (!user) return

        // User has no subscription? Stop here.
        if (!user.subscription) {
            logger.error("Routes", req.method, req.originalUrl, "User has no valid subscription")
            return webserver.renderJson(req, res, "User has no valid subscription", 404)
        }

        // Subscribed as a friend, via PayPal, or via GitHub?
        if (user.subscription.source == "friend") {
            webserver.renderJson(req, res, {friend: user.subscription.enabled})
        } else if (user.subscription.source == "paypal") {
            const subscription = await paypal.subscriptions.getSubscription(user.subscription.id)
            subscription.userId = userId
            webserver.renderJson(req, res, {paypal: subscription})
        } else if (user.subscription.source == "github") {
            webserver.renderJson(req, res, {github: true})
        }
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderJson(req, res, {error: ex.toString()})
    }
})

/**
 * Delete user and cancel its pending jobs / webhooks.
 */
router.delete("/:userId", async (req, res) => {
    try {
        const userId = req.params.userId
        const user: UserData = (await auth.requestValidator(req, res, {userId: userId})) as UserData
        if (!user) return

        // Delete the user from the database.
        await users.delete(user)

        logger.info("Routes", req.method, req.originalUrl)
        webserver.renderJson(req, res, {deleted: true})
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

// USER PREFERENCES
// --------------------------------------------------------------------------

/**
 * Updated user preferences.
 */
router.post("/:userId/preferences", async (req, res) => {
    try {
        const userId = req.params.userId
        const user: UserData = (await auth.requestValidator(req, res, {userId: userId})) as UserData
        if (!user) return

        const preferences: UserPreferences = {}

        // Make sure weather provider is valid.
        if (user.isPro && !_.isNil(req.body.weatherProvider)) {
            const weatherProvider = req.body.weatherProvider

            if (weatherProvider && _.map(weather.providers, "name").indexOf(weatherProvider) < 0) {
                logger.error("Routes", req.method, req.originalUrl, `Invalid weatherProvider: ${weatherProvider}`)
                return webserver.renderError(req, res, "Invalid weather provider", 400)
            }

            preferences.weatherProvider = weatherProvider
        }

        // Make sure linksOn is valid.
        if (!_.isNil(req.body.linksOn)) {
            preferences.linksOn = req.body.linksOn
        }

        // Only PRO users can disable the linkback.
        if (preferences.linksOn == 0 && !user.isPro) {
            preferences.linksOn = settings.plans.free.linksOn
            logger.warn("Routes", req.method, req.originalUrl, `User ${user.id} not a PRO, linksOn changed from 0 to ${settings.plans.free.linksOn}`)
        }

        // Make sure weather unit is valid.
        if (!_.isNil(req.body.weatherUnit)) {
            preferences.weatherUnit = req.body.weatherUnit != "c" ? "f" : "c"
        }

        // Set activity hashtag preference?
        if (!_.isNil(req.body.activityHashtag)) {
            preferences.activityHashtag = req.body.activityHashtag ? true : false
        }

        // Set twitter share preference?
        if (!_.isNil(req.body.twitterShare)) {
            preferences.twitterShare = req.body.twitterShare ? true : false
        }

        // Set user data and save to the database.
        const data: Partial<UserData> = {
            id: userId,
            preferences: preferences
        }
        await users.update(data)

        logger.info("Routes", req.method, req.originalUrl, _.toPairs(preferences).join(" | "))
        webserver.renderJson(req, res, preferences)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

// USER RECIPES MANAGEMENT
// --------------------------------------------------------------------------

/**
 * Create / update / delete user recipes.
 * @param req Express request.
 * @param res Express response.
 */
const routeUserRecipe = async (req: any, res: any) => {
    try {
        const method = req.method.toUpperCase()
        const userId = req.params.userId
        const validated = await auth.requestValidator(req, res, {userId: userId})
        if (!validated) return

        let recipe: RecipeData = req.body

        // Make sure recipe was sent in the correct format.
        if (method != "DELETE") {
            try {
                recipes.validate(recipe)
            } catch (ex) {
                logger.error("Routes", req.method, req.originalUrl, ex, req.body)
                return webserver.renderError(req, res, ex, 400)
            }
        }

        const recipeId = req.params.recipeId || recipe.id
        const user: UserData = await users.getById(userId)

        // User not found?
        if (!user) {
            logger.error("Routes", req.method, req.originalUrl, `User ${userId} not found`)
            return webserver.renderError(req, res, "User not found", 404)
        }

        const username = user.displayName

        // Creating a new recipe?
        if (!recipe.id && method == "POST") {
            if (!user.isPro && user.recipes.length >= settings.plans.free.maxRecipes) {
                throw new Error(`User ${user.id} is not PRO and has reached the free acccount limit`)
            }

            const now = moment.utc().toDate()
            const hex = Math.round(now.getTime() / 1000).toString(16)
            recipe.id = "r" + hex.toLowerCase()

            // Add to user's recipe list.
            user.recipes[recipe.id] = recipe
            logger.info("Routes", req.method, req.originalUrl, `User ${username}`, `New recipe ${recipe.id}: ${recipe.title}`)
        } else {
            const existingRecipe = user.recipes[recipeId]

            // Recipe not found?
            if (!existingRecipe) {
                logger.error("Routes", req.method, req.originalUrl, `User ${username}`, `Recipe ${recipeId} not found`)
                return webserver.renderError(req, res, "Recipe not found", 404)
            }

            // Updating an existing recipe?
            if (method == "POST") {
                user.recipes[recipe.id] = recipe
                logger.info("Routes", req.method, req.originalUrl, `User ${username}`, `Updated recipe ${recipe.id}: ${recipe.title}`, `${recipe.conditions.length} conditions, ${recipe.actions.length} actions`)
            }
            // Deleting a recipe?
            else if (method == "DELETE") {
                delete user.recipes[recipeId]
                logger.info("Routes", req.method, req.originalUrl, `User ${username}`, `Deleted recipe ${recipeId}`)
            }
            // Invalid call.
            else {
                logger.error("Routes", req.method, req.originalUrl, `User ${username}`, `Recipe ${recipeId}`, `Invalid call: ${method}`)
                return webserver.renderError(req, res, "Invalid call", 400)
            }
        }

        // Update recipe count on user data.
        user.recipeCount = Object.keys(user.recipes).length
        await users.update(user, true)
        webserver.renderJson(req, res, recipe)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
}

/**
 * Add a new recipe to the user's automations.
 */
router.post("/:userId/recipes", routeUserRecipe)

/**
 * Delete the specified recipe from the user's automations.
 */
router.delete("/:userId/recipes/:recipeId", routeUserRecipe)

/**
 * Get recipe stats for the user.
 */
router.get("/:userId/recipes/stats", async (req, res) => {
    try {
        const userId = req.params.userId
        const user: UserData = (await auth.requestValidator(req, res, {userId: userId})) as UserData
        if (!user) return

        const arrStats = (await recipes.getStats(user)) as RecipeStats[]

        logger.info("Routes", req.method, req.originalUrl)
        webserver.renderJson(req, res, arrStats)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

// GEARWEAR
// --------------------------------------------------------------------------

/**
 * Get GearWear configurations for the user.
 */
router.get("/:userId/gearwear", async (req, res) => {
    try {
        const userId = req.params.userId
        const user: UserData = (await auth.requestValidator(req, res, {userId: userId})) as UserData
        if (!user) return

        const gearwearConfigs = await gearwear.getForUser(user)

        logger.info("Routes", req.method, req.originalUrl)
        webserver.renderJson(req, res, gearwearConfigs)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

/**
 * Get the specified GearWear configuration.
 */
router.get("/:userId/gearwear/:gearId", async (req, res) => {
    try {
        const gearId = req.params.gearId
        const userId = req.params.userId
        const user: UserData = (await auth.requestValidator(req, res, {userId: userId})) as UserData
        if (!user) return

        // Get GearWear config.
        const config = await gearwear.getById(gearId)

        // Stop here if owner of the specified gear is not the logged user.
        if (config && config.userId != user.id) {
            logger.error("Routes", req.method, req.originalUrl, `User ${user.id} has no access to GearWear ${gearId}`)
            return webserver.renderError(req, res, "No permissions to access this GearWear", 403)
        }

        logger.info("Routes", req.method, req.originalUrl)
        webserver.renderJson(req, res, config)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

/**
 * Updated gearwear configuration for the specified GearWear.
 */
router.post("/:userId/gearwear/:gearId", async (req, res) => {
    try {
        const gearId = req.params.gearId
        const userId = req.params.userId
        const user: UserData = (await auth.requestValidator(req, res, {userId: userId})) as UserData
        if (!user) return

        const configs = await gearwear.getForUser(user)
        const max = settings.plans.free.maxGearWear

        // Check if user has reached the limit of gearwear configs on free accounts.
        if (!user.isPro && configs.length >= max) {
            logger.error("Routes", req.method, req.originalUrl, `User ${user.id} reached limit of ${max} GearWear on free accounts`)
            return webserver.renderError(req, res, `Reached the limit of GearWear on free accounts`, 400)
        }

        const bike = _.find(user.profile.bikes, {id: gearId})
        const shoe = _.find(user.profile.shoes, {id: gearId})

        // Make sure gear exists on the user profile.
        if (!bike && !shoe) {
            logger.error("Routes", req.method, req.originalUrl, `User ${user.id}`, `Gear ${gearId} not found`)
            return webserver.renderError(req, res, "Gear not found", 404)
        }

        // Get GearWear configuration from request body and validate it.
        const config = {
            id: gearId,
            userId: userId,
            components: req.body.components,
            updating: false
        }
        gearwear.validate(user, config)

        // Save GearWear configuration to the database.
        const result = gearwear.upsert(user, config)

        logger.info("Routes", req.method, req.originalUrl)
        webserver.renderJson(req, res, result)
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

/**
 * Delete the specified GearWear configuration.
 */
router.delete("/:userId/gearwear/:gearId", async (req, res) => {
    try {
        const gearId = req.params.gearId
        const userId = req.params.userId
        const user: UserData = (await auth.requestValidator(req, res, {userId: userId})) as UserData
        if (!user) return

        // Get GearWear config and check its owner.
        const config = await gearwear.getById(gearId)

        // Stop here if owner of the specified gear is not the logged user.
        if (config.userId != user.id) {
            logger.error("Routes", req.method, req.originalUrl, `User ${user.id} has no access to GearWear ${gearId}`)
            return webserver.renderError(req, res, "No permissions to access this GearWear", 403)
        }

        // Delete the GearWear from the database.
        await gearwear.delete(config)

        logger.info("Routes", req.method, req.originalUrl)
        webserver.renderJson(req, res, {deleted: true})
    } catch (ex) {
        logger.error("Routes", req.method, req.originalUrl, ex)
        webserver.renderError(req, res, ex, 500)
    }
})

export = router
