export function buddyMealLoggingEnabled() {
  return process.env.MCP_BUDDY_MEAL_LOGGING_ENABLED !== "false";
}
