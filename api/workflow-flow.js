import flowHandlers from "../.well-known/workflow/v1/flow.cjs";
import { runWorkflowWebHandler } from "../src/a2a/workflow-node-adapter.js";

export default function workflowFlow(req, res) {
  return runWorkflowWebHandler(flowHandlers.POST, req, res);
}
