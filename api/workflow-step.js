import stepHandlers from "../.well-known/workflow/v1/step.cjs";
import { runWorkflowWebHandler } from "../src/a2a/workflow-node-adapter.js";

export default function workflowStep(req, res) {
  return runWorkflowWebHandler(stepHandlers.POST, req, res);
}
