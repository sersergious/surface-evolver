import client from './client'

export type JobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'

export interface JobResult {
  job_id: string
  session_id: string
  status: JobStatus
  steps_requested: number
  steps_completed: number
  energy_start: number | null
  energy_end: number | null
  error: string | null
}

export async function getJob(jobId: string): Promise<JobResult> {
  return client.get<JobResult>(`/jobs/${jobId}`)
}

export async function cancelJob(jobId: string): Promise<void> {
  return client.delete(`/jobs/${jobId}`)
}
