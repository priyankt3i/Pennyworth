const FINAL_SUMMARY_INSTRUCTION = "The tool execution budget is exhausted. Summarize the evidence collected so far. Distinguish successful tool results, failed or denied actions, and unfinished work. A tool returning output does not prove the requested change succeeded. Do not request more tools or claim unfinished actions succeeded.";
const limitNotice = rounds => `Tool execution limit (${rounds} rounds) reached. Some work may remain; ask me to continue if needed.`;

function toolOutcome(result) {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  if (/^(?:COMMAND_EXECUTION_DENIED|FILE_READ_DENIED|FILE_WRITE_DENIED):/.test(text)) return "denied";
  if (/^SECURITY_BLOCKED:/.test(text)) return "blocked";
  try {
    const value = typeof result === "object" ? result : JSON.parse(text);
    if (value?.success === false) return "reported failure";
    if (value?.success === true) return "reported success";
  } catch (_) {}
  return "returned output; success unverified";
}

function recoveryReport(trace, reason) {
  const attempts = [];
  for (const event of trace || []) {
    if (event.stage === "tool_exec_start") attempts.push({ tool: event.tool, outcome: "started; final outcome unknown" });
    if (["tool_exec_result", "tool_exec_error"].includes(event.stage)) {
      const current = attempts.at(-1);
      if (current) {
        current.outcome = event.stage === "tool_exec_error" ? "failed" : event.outcome || "returned output; success unverified";
        current.detail = event.result || event.error;
      }
    }
  }
  const lines = [reason];
  if (attempts.length) {
    lines.push("Recorded tool attempts (these do not establish that the overall task is complete):");
    if (attempts.length > 8) lines.push(`Showing the last 8 of ${attempts.length} attempts; see the tool trace for earlier entries.`);
    for (const attempt of attempts.slice(-8)) {
      const name = String(attempt.tool || "unknown tool").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
      lines.push(`- ${name}: ${attempt.outcome}.`);
      if (attempt.detail) lines.push("```text\n" + String(attempt.detail).slice(0, 500).replace(/`/g, "'") + "\n```");
    }
    lines.push("No tool attempts were replayed automatically. Completed changes are not undone; verify their state before continuing.");
  }
  return lines.join("\n\n");
}
function formatProviderError(error) {
  const status = error?.response?.status;
  if (["ECONNABORTED", "ETIMEDOUT"].includes(error?.code)) return "Provider request timed out. Check connectivity or local model responsiveness before retrying.";
  if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET"].includes(error?.code)) return `Provider connection failed (${error.code}). Check the endpoint and connection; for Ollama, check that its service is running.`;
  if (status === 401 || status === 403) return `HTTP ${status}: Provider access was rejected. Check the API key and model permissions in Settings.`;
  if (status === 429) return "HTTP 429: Provider rate or quota limit reached. Check usage and retry later.";
  if (status >= 500) return `HTTP ${status}: Provider service error. Retry later.`;
  const detail = error?.response?.data?.error?.message || error?.message || "Provider request failed";
  return `${status ? `HTTP ${status}: ` : ""}${String(detail).slice(0, 500)}`;
}
module.exports = { FINAL_SUMMARY_INSTRUCTION, limitNotice, toolOutcome, recoveryReport, formatProviderError };
