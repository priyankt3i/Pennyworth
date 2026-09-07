const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getExecutionContext } = require("../core/execution-context");
const { classifyCommandAccess, assessCommandRisk, analyzeCommandConsequences, executeSystemCommand } = require("../core/tools/system-tools");

test("sandbox evidence and unknown host scope stay explicit", () => {
  const probe = { env: {}, exists: () => false, read: () => "" };
  assert.match(getExecutionContext(probe).scope, /unverified/);
  for (const env of [{ FLATPAK_ID: "app" }, { SNAP: "/snap/app" }, { container: "podman" }]) {
    assert.equal(getExecutionContext({ ...probe, env }).scope, "sandbox/container");
  }
  assert.ok(getExecutionContext({ ...probe, exists: p => p === "/.dockerenv" }).evidence.includes("Docker"));
  assert.match(getExecutionContext({ ...probe, read: () => "0::/kubepods/test" }).scope, /sandbox/);
});

test("read queries, writes and uncertain shell logic have separate access labels", () => {
  assert.equal(classifyCommandAccess("gsettings get org.gnome.desktop.interface enable-animations"), "READ");
  assert.equal(classifyCommandAccess("gsettings set org.gnome.desktop.interface enable-animations false"), "WRITE");
  for (const command of ["npm test", "git status; touch /tmp/a", "pwd > /tmp/a", "git diff --output=/tmp/a", "python -c 'print(1)'", "hostname newname"]) {
    assert.notEqual(assessCommandRisk(command).score, 1, command);
    assert.match(classifyCommandAccess(command), /WRITE/, command);
  }
});

test("approval detail includes risk, access and execution scope", () => {
  const command = "gsettings get org.gnome.desktop.interface enable-animations";
  const detail = analyzeCommandConsequences(command, assessCommandRisk(command));
  assert.match(detail, /Access: READ/);
  assert.match(detail, /Execution:/);
  assert.match(detail, /Risk Assessment:/);
});

test("unavailable sandbox never falls back to host", () => {
  const { executionPlan } = require("../core/execution-runner");
  const attempts = [];
  assert.throws(() => executionPlan("sandbox", { platform: "linux", probe: (exe, args) => { attempts.push(exe); return { status: 1 }; } }), /SANDBOX_UNAVAILABLE/);
  assert.deepEqual(attempts, ["/usr/bin/bwrap"]);
});
