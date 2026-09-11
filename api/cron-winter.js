import { isAuthorizedCron, runScheduledScout } from "../src/cron.js";

export default async function handler(request, response) {
  if (!isAuthorizedCron(request)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    response.status(200).json(await runScheduledScout(8));
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
