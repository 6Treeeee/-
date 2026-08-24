const profile = Object.freeze({
  kind: "A2AControlProfile",
  name: "Owner A2A Control Layer",
  version: "1.0.0",
  protocol: "minimal-a2a-control/1",
  a2a_project_compatibility: "domain-model-only",
  a2a_protocol_compliant: false,
  transport: "authenticated HTTP JSON",
  authentication: "Ed25519 signed requests or configured bearer hashes",
  roles: ["planner", "executor", "reviewer", "research", "decision"],
  endpoints: {
    create_task: "POST /tasks",
    list_tasks: "GET /tasks",
    task_state: "GET /tasks/:id",
    task_result: "GET /tasks/:id/result",
    decision: "POST /tasks/:id/decision",
    executor_event: "POST /tasks/:id/executor",
    stop: "POST /tasks/:id/stop",
  },
});

export default function agentProfile(req, res) {
  res.setHeader("cache-control", "public, max-age=300");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("x-content-type-options", "nosniff");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED" } }));
    return;
  }
  res.statusCode = 200;
  res.end(req.method === "HEAD" ? undefined : JSON.stringify(profile));
}
