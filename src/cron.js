import { config } from "./config.js";
import { fetchAllTweets } from "./x.js";
import { findFire, formatReport } from "./scout.js";
import { sendToSlack } from "./slack.js";

export function isAuthorizedCron(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.authorization === `Bearer ${secret}`;
}

function scheduledHourIsNine(utcHour) {
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
  return localHour === "09";
}

export async function runScheduledScout(utcHour) {
  if (!scheduledHourIsNine(utcHour)) {
    return { skipped: "daylight-saving slot", sent: false };
  }

  const { tweets, errors } = await fetchAllTweets(config);
  const items = findFire(tweets, {
    launchHandles: config.launchHandles,
    minAgeHours: config.minAgeHours,
    lookbackHours: config.lookbackHours,
    maxItems: config.maxReportItems,
  });
  const report = formatReport(items);
  if (items.length > 0) await sendToSlack(report);

  return {
    scanned: tweets.length,
    sourceFailures: errors.length,
    qualifyingLaunches: items.length,
    sent: items.length > 0,
  };
}
