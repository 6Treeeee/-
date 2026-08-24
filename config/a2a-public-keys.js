// Public verification keys only. Private keys are stored outside this repository.
export const a2aPublicKeys = Object.freeze([
  {
    "id": "decision-owner-v1",
    "role": "decision",
    "principal_id": "gpt-decision-owner",
    "workspace_ids": [
      "content-reader"
    ],
    "public_key_pem": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAg6141fjpIKj4dM4QrECmKH/iIanW8UA03qhZEgw7myk=\n-----END PUBLIC KEY-----\n"
  },
  {
    "id": "worker-owner-machine-v1",
    "role": "worker",
    "principal_id": "owner-machine-codex-1",
    "workspace_ids": [
      "content-reader"
    ],
    "public_key_pem": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAJfKoWWWdP3qZnlUyG7FYydOgVRNt05WcwsGXSmTQFuA=\n-----END PUBLIC KEY-----\n"
  }
]);
