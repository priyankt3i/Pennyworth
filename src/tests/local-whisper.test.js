const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createTranscriptionService } = require('../main/local-whisper');

function fixture(t, options = {}) {
  const workers = [];
  const service = createTranscriptionService({
    ...options,
    createWorker() {
      const worker = new EventEmitter();
      worker.messages = [];
      worker.postMessage = message => worker.messages.push(message);
      worker.terminate = () => { worker.terminated = true; return Promise.resolve(); };
      workers.push(worker);
      return worker;
    },
  });
  t.after(() => service.terminateWorker());
  return { ...service, workers };
}
const audio = () => new Float32Array([0.2, 0.3]);

test('final transcription queues behind a live request and keeps its audio snapshot', async t => {
  const service = fixture(t);
  const first = service.transcribeLocalPcm(audio());
  const samples = audio();
  const second = service.transcribeLocalPcm(samples);
  samples.fill(0);
  const worker = service.workers[0];
  assert.equal(worker.messages.length, 1);
  worker.emit('message', { id: worker.messages[0].id, ok: true, text: 'partial' });
  assert.equal((await first).text, 'partial');
  assert.equal(worker.messages.length, 2);
  assert.notEqual(worker.messages[1].pcmBuffer.readFloatLE(0), 0);
  worker.emit('message', { id: worker.messages[1].id, ok: true, text: 'final' });
  assert.equal((await second).text, 'final');
});

test('loading timeout kills the worker and stale exit cannot cancel its replacement', async t => {
  const service = fixture(t, { loadTimeoutMs: 15 });
  const result = await service.transcribeLocalPcm(audio());
  assert.match(result.error, /model loading timed out/);
  const old = service.workers[0];
  assert.equal(old.terminated, true);
  const retry = service.transcribeLocalPcm(audio());
  const current = service.workers[1];
  old.emit('exit', 1);
  old.emit('error', new Error('late error'));
  current.emit('message', { id: current.messages[0].id, ok: true, text: 'recovered' });
  assert.equal((await retry).text, 'recovered');
});

test('model-ready signal starts a separate inference deadline and reports progress', async t => {
  const service = fixture(t, { loadTimeoutMs: 1000, inferenceTimeoutMs: 15 });
  const stages = [];
  const result = service.transcribeLocalPcm(audio(), { onStatus: stage => stages.push(stage) });
  const worker = service.workers[0];
  worker.emit('message', { id: worker.messages[0].id, stage: 'transcribing' });
  assert.match((await result).error, /transcription timed out/);
  assert.deepEqual(stages, ['loading', 'transcribing', 'error']);
  assert.equal(worker.terminated, true);
});

test('termination settles active and queued requests; queue and audio sizes are bounded', async t => {
  const service = fixture(t);
  const pending = [1, 2, 3].map(() => service.transcribeLocalPcm(audio()));
  assert.match((await service.transcribeLocalPcm(audio())).error, /queue is full/);
  assert.match((await service.transcribeLocalPcm(Buffer.alloc(3))).error, /Invalid PCM/);
  assert.match((await service.transcribeLocalPcm(new Float32Array(16000 * 121))).error, /two minutes/);
  service.terminateWorker();
  for (const result of await Promise.all(pending)) assert.equal(result.ok, false);
});

test('worker startup and postMessage failures settle without leaking pending requests', async () => {
  for (const createWorker of [
    () => { throw new Error('startup failed'); },
    () => Object.assign(new EventEmitter(), {
      postMessage() { throw new Error('send failed'); }, terminate() {},
    }),
  ]) {
    const service = createTranscriptionService({ createWorker });
    assert.equal((await service.transcribeLocalPcm(audio())).ok, false);
    service.terminateWorker();
  }
});
