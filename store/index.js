export const state = () => ({
    lastUserFetch: new Date().valueOf(),
    user: null,
    gearwearCount: null,
    recipeProperties: null,
    recipeActions: null,
    recipeMaxLength: null,
    weatherProviders: null,
    linksOnPercent: null,
    sportTypes: [],
    freePlanDetails: {},
    proPlanDetails: {}
})

export const getters = {
    user(state) {
        return state.user
    },
    lastUserFetch(state) {
        return state.lastUserFetch
    }
}

export const mutations = {
    setRecipeOptions(state, data) {
        state.recipeProperties = data.recipeProperties
        state.recipeActions = data.recipeActions
        state.recipeMaxLength = data.recipeMaxLength
    },
    setWeatherProviders(state, data) {
        state.weatherProviders = data
    },
    setLinksOnPercent(state, data) {
        state.linksOnPercent = data
    },
    setSportTypes(state, data) {
        state.sportTypes = data
    },
    setPlanDetails(state, data) {
        state.freePlanDetails = data.free
        state.proPlanDetails = data.pro
    },
    setUser(state, data) {
        state.user = data
    },
    setUserPreferences(state, data) {
        if (!state.user.preferences) state.user.preferences = {}
        state.user.preferences = Object.assign(state.user.preferences, data)
    },
    setUserSubscription(state, data) {
        state.user.subscription = data
    },
    setLastUserFetch(state, data) {
        state.lastUserFetch = data
    },
    addUserRecipe(state, recipe) {
        state.user.recipes[recipe.id] = recipe
    },
    deleteUserRecipe(state, recipe) {
        delete state.user.recipes[recipe.id]
    },
    setGearWearCount(state, count) {
        state.gearwearCount = count
    }
}

export const actions = {
    async nuxtServerInit({commit, dispatch, state}) {
        if (process.server) {
            const core = require("strautomator-core")
            const settings = require("setmeup").settings

            // Set recipe properties, actions and rules.
            const recipeOptions = {
                recipeProperties: core.recipes.propertyList,
                recipeActions: core.recipes.actionList,
                recipeMaxLength: settings.recipes.maxLength
            }
            commit("setRecipeOptions", recipeOptions)

            // Set weather providers.
            const weatherProviders = core.weather.providers.map((p) => {
                return {value: p.name, text: p.title}
            })
            weatherProviders.unshift({value: null, text: "Default weather provider"})
            commit("setWeatherProviders", weatherProviders)

            // Set links on percentage.
            const percent = Math.round(100 / settings.plans.free.linksOn)
            commit("setLinksOnPercent", percent)

            // Set sport types.
            const sportTypes = Object.keys(core.StravaSport).map((s) => core.StravaSport[s])
            commit("setSportTypes", sportTypes)

            // Set free / PRO plan details.
            commit("setPlanDetails", settings.plans)
        }

        let user = state.user
        let oauth = state.oauth

        if (!user && oauth && oauth.accessToken) {
            await dispatch("assignUser")
        }
    },
    async assignUser({commit, state}) {
        this.$axios.setToken(state.oauth.accessToken)
        const user = await this.$axios.$get(`/api/users/${state.oauth.user.id}`)
        commit("setUser", user)
    }
}
