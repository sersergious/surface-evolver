import * as seManager from "./se-manager";
import * as wsHub from "./ws-hub";

export type JobStatus = "queued" | "running" | "completed" | "cancelled" | "failed";

export interface JobResult {
  job_id:          string;
  session_id:      string;
  status:          JobStatus;
  steps_requested: number;
  steps_completed: number;
  energy_start:    number | null;
  energy_end:      number | null;
  error:           string | null;
}

const jobs = new Map<string, JobResult>();

export function getJob(jobId: string): JobResult | undefined {
  return jobs.get(jobId);
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || (job.status !== "queued" && job.status !== "running")) return false;
  seManager.cancelCurrent();
  job.status = "cancelled";
  return true;
}

export async function submitJob(
  sessionId: string,
  steps: number,
  progressCb: (step: number, total: number, energy: number) => void,
): Promise<JobResult> {
  const jobId = crypto.randomUUID();
  const job: JobResult = {
    job_id:          jobId,
    session_id:      sessionId,
    status:          "queued",
    steps_requested: steps,
    steps_completed: 0,
    energy_start:    null,
    energy_end:      null,
    error:           null,
  };
  jobs.set(jobId, job);

  (async () => {
    job.status = "running";
    try {
      const result = await seManager.iterateAsync(sessionId, steps, async (step, total, energy) => {
        progressCb(step, total, energy);
      });
      job.steps_completed = result.steps_completed;
      job.energy_start    = result.energy_start;
      job.energy_end      = result.energy_end;
      if (job.status !== "cancelled") {
        job.status = "completed";
        wsHub.broadcast(sessionId, { type: "completed", energy: job.energy_end });
      }
    } catch (e) {
      if (job.status !== "cancelled") {
        job.status = "failed";
        job.error  = String(e);
        wsHub.broadcast(sessionId, { type: "error", message: String(e) });
      }
    }
  })();

  return job;
}
