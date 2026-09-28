import { isAuthorizedCron } from "../src/cron.js";
import { runTick } from "../src/pipeline.js";

export default async function handler(request, response) {
  if (!isAuthorizedCron(request)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const result = await runTick();
    console.info("fire-scout tick", JSON.stringify({
      digest: result.digest,
      sent: result.sent,
      deliveryReason: result.deliveryReason,
      collected: result.collected,
      scanned: result.scanned,
      sourceFailures: result.sourceFailures,
      jevCoverage: result.jevCoverage,
      jevCandidates: result.jevCandidates,
    }));
    response.status(200).json(result);
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
