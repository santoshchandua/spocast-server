import { deliverEmail, cleanup } from './jobs.js';
import { syncFeed } from './cricket.js';
import { generateAudio } from './audio.js';

export async function runWorkerCycle(db, config, jobs = { deliverEmail, syncFeed, generateAudio, cleanup }, log = entry => console.error(JSON.stringify(entry))) {
  const results = {};
  // Independent error boundaries: a provider outage must never suppress privacy cleanup.
  for (const name of ['deliverEmail', 'syncFeed', 'generateAudio', 'cleanup']) {
    if (name === 'syncFeed' && !config.licenseConfirmed) { results[name] = 'disabled'; continue; }
    try { await jobs[name](db, config); results[name] = 'completed'; }
    catch { results[name] = 'failed'; log({ event: 'worker_job_failed', job: name }); }
  }
  return results;
}
