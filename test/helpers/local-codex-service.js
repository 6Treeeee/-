// Test-only single-writer persistence adapter. Never used by the deployed service.
import { randomUUID } from "node:crypto";
import { createInitialTask, reduceTaskEvent, recordRejectedTaskEvent } from "../../src/a2a/state-machine.js";
import { eventOutcomeFromTask } from "../../src/a2a/control-service.js";

export function localCodexService({ state = null, save = () => {} } = {}) {
  const service = {
    state,
    async createTask(input) {
      if (this.state) {
        if (this.state.request_id !== input.request_id || this.state.workspace_id !== input.workspace_id) throw new Error("PROBE_SINGLE_TASK_ONLY");
        return structuredClone(this.state);
      }
      this.state = createInitialTask(input, `wrun_local_${randomUUID().replaceAll("-", "")}`);
      save(this.state);
      return structuredClone(this.state);
    },
    async getTask(id) {
      if (this.state?.task_id !== id) throw new Error("PROBE_TASK_NOT_FOUND");
      return structuredClone(this.state);
    },
    async sendDecision(id, event) { return this.sendExecutorEvent(id, event); },
    async sendExecutorEvent(id, event) {
      await this.getTask(id);
      try { this.state = reduceTaskEvent(this.state, event); }
      catch (error) { this.state = recordRejectedTaskEvent(this.state, event, error); }
      save(this.state);
      return { accepted: true, task_id: id, event_id: event.event_id, ...eventOutcomeFromTask(this.state, event.event_id) };
    },
    async executorEvent(id, { kind, payload, workerId, workspaceId }) {
      return this.sendExecutorEvent(id, { event_id: randomUUID(), at: new Date().toISOString(), kind, payload, worker_id: workerId, workspace_id: workspaceId });
    },
  };
  return service;
}
