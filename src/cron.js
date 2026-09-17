import { config } from "./config.js";
import { fetchAllTweets } from "./x.js";
import {
  findFire,
  formatReport,
  hasHealthyClassification,
  hasHealthyCoverage,
  selectClassificationCandidates,
} from "./scout.js";
import { sendToSlack } from "./slack.js";
import { classifyPosts } from "./typesafe.js";

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

  const { tweets, errors, sourceStats } = await fetchAllTweets(config);
  const candidates = selectClassificationCandidates(tweets, { launchHandles: config.launchHandles });
  const classification = await classifyPosts(candidates);
  const items = findFire(tweets, {
    launchHandles: config.launchHandles,
    minAgeHours: config.minAgeHours,
    lookbackHours: config.lookbackHours,
    rootContextHours: config.rootContextHours,
    maxItems: config.maxReportItems,
    decisions: classification.decisions,
    requireDecisions: !classification.disabled,
  });
  const report = formatReport(items);
  const coverageHealthy = hasHealthyCoverage(tweets, errors, sourceStats);
  const classificationHealthy = hasHealthyClassification(classification, candidates.length);
  if (coverageHealthy && classificationHealthy) await sendToSlack(report);

  return {
    scanned: tweets.length,
    sourceFailures: errors.length,
    feedCoverage: {
      forYou: sourceStats["for-you"] || 0,
      following: sourceStats.following || 0,
    },
    qualifyingLaunches: items.length,
    jevClassified: classification.classified,
    jevCandidates: candidates.length,
    jevFailures: classification.failed,
    sent: coverageHealthy && classificationHealthy,
  };
}
