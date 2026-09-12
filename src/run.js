import { config } from "./config.js";
import { fetchAllTweets } from "./x.js";
import { findFire, formatReport } from "./scout.js";
import { sendToSlack } from "./slack.js";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force") || process.env.FORCE_RUN === "1";

function scheduledForAmsterdamHour(targetHour) {
  const schedule = process.env.CRON_SCHEDULE;
  if (!schedule) {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam",
      hour: "2-digit",
      hour12: false,
    }).format(new Date());
    return Number(hour) === targetHour;
  }

  const utcHour = Number(schedule.split(" ")[1]);
  if (!Number.isInteger(utcHour)) return false;
  const today = new Date();
  const scheduledTime = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
    utcHour
  ));
  const localHour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    hour12: false,
  }).format(scheduledTime);
  return Number(localHour) === targetHour;
}

async function main() {
  if (!force && !scheduledForAmsterdamHour(config.digestHourAmsterdam)) {
    console.log(
      `Skipping: this schedule does not represent ${String(config.digestHourAmsterdam).padStart(2, "0")}:00 in Europe/Amsterdam today.`
    );
    return;
  }

  const { tweets, errors } = await fetchAllTweets(config);
  const items = findFire(tweets, {
    launchHandles: config.launchHandles,
    minAgeHours: config.minAgeHours,
    lookbackHours: config.lookbackHours,
    maxItems: config.maxReportItems,
  });
  const report = formatReport(items);
  console.log(report);
  console.log(`\nScanned ${tweets.length} unique posts. ${errors.length} source(s) failed.`);

  const coverageHealthy = errors.length <= 2;
  if (!dryRun && coverageHealthy) await sendToSlack(report);
  if (!dryRun && !coverageHealthy) {
    console.log("No Slack message sent because source coverage was incomplete.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
