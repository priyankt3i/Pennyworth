const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executionPlan, runProcess } = require("../core/execution-runner");

test("real sandbox denies host filesystem and session access while allowing temporary writes", async t => {
  let plan;
  try { plan = executionPlan("sandbox"); }
  catch (error) {
    if (process.env.PENNYWORTH_REQUIRE_SANDBOX_TEST === "1") throw error;
    t.skip(error.message);
    return;
  }
  const result = await runProcess(plan, 'test ! -e /home && test ! -e /run/user && test ! -e /etc/shadow && test -z "$DBUS_SESSION_BUS_ADDRESS" && echo temporary > /tmp/probe && test "$(cat /tmp/probe)" = temporary');
  assert.equal(result.exitCode, 0, result.stderr);
  const second = await runProcess(plan, 'test ! -e /tmp/probe');
  assert.equal(second.exitCode, 0, "temporary files must not persist between commands");
});
