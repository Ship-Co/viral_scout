import { runDailyScout } from "./pipeline.js";

const dryRun = process.argv.includes("--dry-run");

runDailyScout({ send: !dryRun }).then((result) => {
  console.log(result.report);
  console.log(`\nScanned ${result.scanned} posts; remembered ${result.remembered}; ${result.sourceFailures} source failure(s).`);
  console.log(`Jev coverage: ${result.jevCoverage}/${result.jevCandidates}; classified ${result.jevClassifiedNow} now.`);
  if (!dryRun && !result.sent) {
    console.log(`No Slack message sent: source coverage ${result.coverageHealthy ? "healthy" : "incomplete"}; Jev coverage ${result.classificationHealthy ? "healthy" : "incomplete"}.`);
  }
}).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
