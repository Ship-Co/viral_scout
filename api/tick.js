import { isAuthorizedCron } from "../src/cron.js";
import { runTick } from "../src/pipeline.js";

export default async function handler(request, response) {
  if (!isAuthorizedCron(request)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    response.status(200).json(await runTick());
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
