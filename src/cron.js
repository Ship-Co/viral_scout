import { config } from "./config.js";
import { fetchAllTweets } from "./x.js";
import { findFire, formatReport } from "./scout.js";
import { sendToSlack } from "./slack.js";

export function isAuthorizedCron(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.authorization === `Bearer ${secret}`;
}

function scheduledHourMatchesAmsterdam(utcHour, targetHour) {
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

export async function runScheduledScout(utcHour) {
  if (!scheduledHourMatchesAmsterdam(utcHour, config.digestHourAmsterdam)) {
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
  const coverageHealthy = errors.length <= 2;
  if (coverageHealthy) await sendToSlack(report);

  return {
    scanned: tweets.length,
    sourceFailures: errors.length,
    qualifyingLaunches: items.length,
    sent: coverageHealthy,
  };
}
