import _ from "lodash"

export default {
    // Share recipe rules used to validate conditions.
    computed: {
        booleanActions() {
            return ["generateName", "hideHome", "hideStatPace", "hideStatSpeed", "hideStatCalories", "hideStatHeartRate", "hideStatPower"]
        },
        recipeRules() {
            return {
                required: (value) => {
                    if (!value || value.toString().trim().length < 1) return `Field is required`
                    return true
                },
                number: (value) => {
                    if (isNaN(value)) return "Invalid number"
                    const num = parseFloat(value)
                    if (num <= 0) return "Must be higher than zero"
                    return true
                },
                anyNumber: (value) => {
                    if (isNaN(value)) return "Invalid number"
                    if (/^-?\d*\.?\d*$/.test(value)) return true
                    return "Invalid number"
                },
                time: (value) => {
                    if (!value || value.length < 4) return "Invalid time"
                    const arrValue = value.split(":")
                    if (arrValue.length != 2) return "Invalid time"
                    if (isNaN(arrValue[0]) || isNaN(arrValue[1])) return "Invalid time"
                    const arrTime = arrValue.map((v) => parseInt(v))
                    if (arrTime[0] < 0 || arrTime[0] > 23 || arrTime[1] < 0 || arrTime[1] > 59) return "Invalid time"
                    return true
                },
                timer: (value) => {
                    if (!value || value.length < 4) return "Invalid timer"
                    const arrValue = value.split(":")
                    if (arrValue.length != 2) return "Invalid timer"
                    if (isNaN(arrValue[0]) || isNaN(arrValue[1])) return "Invalid timer"
                    const arrTime = arrValue.map((v) => parseInt(v))
                    if (arrTime[0] < 0 || arrTime[1] < 0 || arrTime[1] > 59) return "Invalid timer"
                    return true
                },
                text: (value) => {
                    if (value.length > 0) return true
                    return "Empty text"
                },
                url: (value) => {
                    if (!value) return "Empty URL"
                    if (/(http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/.test(value)) return true
                    return "Invalid URL"
                }
            }
        }
    },
    methods: {
        // Returns an action summary.
        actionSummary(action) {
            const actionType = _.find(this.$store.state.recipeActions, {value: action.type}).text
            const valueText = action.friendlyValue || action.value
            const isBoolean = this.booleanActions.includes(action.type)

            if (isBoolean) {
                if (action.value != true) {
                    return `${actionType} (${valueText})`
                }

                return `${actionType}`
            } else {
                return `${actionType}: ${valueText}`
            }
        },
        // Returns the text for the specified action.
        actionText(action) {
            return _.find(this.$store.state.recipeActions, {value: action.type}).text
        },
        // Returns a condition summary.
        conditionSummary(condition) {
            const property = _.find(this.$store.state.recipeProperties, {value: condition.property})
            if (!property) {
                return `!!! ERROR !!! Invalid property: ${condition.property}`
            }

            const operator = _.find(property.operators, {value: condition.operator})
            if (!operator) {
                return `!!! ERROR !!! Invalid condition operator: ${condition.operator}`
            }

            let fieldText = property.text
            let operatorText = operator.text
            let valueText = condition.friendlyValue || condition.value

            // Has a suffix?
            const suffix = this.$store.state.user.profile.units == "imperial" ? property.impSuffix || property.suffix : property.suffix
            if (suffix) {
                valueText += ` ${suffix}`
            }

            // Boolean do not need the "is" text.
            if (property.type == "boolean") {
                return `${fieldText}: ${valueText}`
            }

            return `${fieldText} ${operatorText} ${valueText}`
        },
        // Returns the text for the specified condition.
        conditionPropertyText(condition) {
            return _.find(this.$store.state.recipeProperties, {value: condition.property}).text
        },
        // Returns the code for the recipe logical operators (ALL, ANY or SOME).
        codeLogicalOperator(recipe) {
            if (recipe.op == "AND" && (recipe.samePropertyOp == "AND" || recipe.conditions.length < 3)) return "ALL"
            if (recipe.op == "OR" && (recipe.samePropertyOp == "OR" || recipe.conditions.length < 3)) return "ANY"
            return "SOME"
        }
    }
}
