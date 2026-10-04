const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const fakePool = { query: async () => ({ rows: [{ id: 9, content: 'hello' }] }) };
const dbModule = require.resolve('../config/db');
require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: fakePool };
const axios = require('axios');
const { sendMessage } = require('../controllers/chatController');

const originalPost = axios.post;
const originalUrl = process.env.MODERATION_SERVICE_URL;
let queryCalls;
let socketEvents;
let response;
let outgoingRequest;

function part(decision, score) {
  return { score, decision, categories: {} };
}

function moderationResult({ textDecision, textScore, imageDecision, imageScore, label = 'Gun', confidence = 0.75 }) {
  const text = textDecision ? part(textDecision, textScore) : undefined;
  const image = imageDecision ? {
    score: imageScore,
    decision: imageDecision,
    categories: {
      normal: 0.999,
      nsfw: 0.001,
      weapons: {
        detected: confidence > 0,
        detections: confidence > 0 ? [{ label, confidence }] : [],
      },
    },
  } : undefined;
  const parts = [text, image].filter(Boolean);
  const rank = { allow: 0, warn: 1, block: 2 };
  const decision = parts.map((p) => p.decision).sort((a, b) => rank[b] - rank[a])[0];
  return {
    score: Math.max(...parts.map((p) => p.score)),
    decision,
    ...(text ? { text } : {}),
    ...(image ? { image } : {}),
  };
}

function harness(body, result, postError) {
  queryCalls = [];
  socketEvents = [];
  outgoingRequest = null;
  fakePool.query = async (...args) => {
    queryCalls.push(args);
    return { rows: [{ id: 9, sender_id: 3, receiver_id: 4, content: body.content || '', decision: args[1][3] }] };
  };
  axios.post = async (url, data, config) => {
    outgoingRequest = { url, data, config };
    if (postError) throw postError;
    return { status: 200, data: result };
  };
  response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  const req = {
    headers: { 'x-user-id': '3' },
    body: { receiver_id: 4, ...body },
    app: { get(key) {
      if (key === 'io') return { to: (socket) => ({ emit: (event, message) => socketEvents.push({ socket, event, message }) }) };
      if (key === 'onlineUsers') return new Map([['4', 'socket-4']]);
      return undefined;
    } },
  };
  return sendMessage(req, response);
}

test.beforeEach(() => {
  process.env.MODERATION_SERVICE_URL = 'http://moderation.test/';
});

test.afterEach(() => {
  axios.post = originalPost;
  if (originalUrl === undefined) delete process.env.MODERATION_SERVICE_URL;
  else process.env.MODERATION_SERVICE_URL = originalUrl;
});

test('safe text is moderated, stored, and delivered', async () => {
  await harness({ content: 'hello' }, moderationResult({ textDecision: 'allow', textScore: 0.1 }));
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.decision, 'allow');
  assert.equal(response.body.delivered, true);
  assert.equal(queryCalls.length, 1);
  assert.equal(socketEvents.length, 1);
  assert.equal(outgoingRequest.url, 'http://moderation.test/moderate-content');
  assert.deepEqual(outgoingRequest.data, { text: 'hello' });
});

test('harmful text is stored as blocked but not delivered', async () => {
  await harness({ content: 'kill him' }, moderationResult({ textDecision: 'block', textScore: 0.96 }));
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.decision, 'block');
  assert.equal(response.body.delivered, false);
  assert.equal(queryCalls[0][1][3], 'block');
  assert.equal(socketEvents.length, 0);
});

test('text warning keeps the existing flagged delivery behavior', async () => {
  await harness({ content: 'shut up' }, moderationResult({ textDecision: 'warn', textScore: 0.63 }));
  assert.equal(response.body.decision, 'warn');
  assert.equal(response.body.delivered, true);
  assert.equal(response.body.message.decision, 'warn');
  assert.equal(socketEvents.length, 1);
});

test('allowed normal image is moderated but not falsely stored or delivered', async () => {
  const image = moderationResult({ imageDecision: 'allow', imageScore: 0.01, confidence: 0 });
  await harness({ image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, image);
  assert.equal(response.statusCode, 501);
  assert.equal(response.body.decision, 'allow');
  assert.equal(response.body.delivered, false);
  assert.equal(queryCalls.length, 0);
  assert.deepEqual(outgoingRequest.data, { image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' });
});

test('weapon image block is audited with detections but not delivered', async () => {
  const image = moderationResult({ imageDecision: 'block', imageScore: 0.91, confidence: 0.91 });
  await harness({ image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, image);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.decision, 'block');
  assert.equal(response.body.delivered, false);
  assert.equal(response.body.moderation.image.categories.weapons.detections[0].label, 'Gun');
  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0][1][3], 'block');
  assert.equal(queryCalls[0][1][2], '[blocked image message]');
  assert.equal(socketEvents.length, 0);
});

test('text plus normal image runs both pipelines and reports image-storage limitation', async () => {
  const result = moderationResult({ textDecision: 'allow', textScore: 0.1, imageDecision: 'allow', imageScore: 0.01, confidence: 0 });
  await harness({ content: 'hello', image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, result);
  assert.equal(response.statusCode, 501);
  assert.equal(response.body.decision, 'allow');
  assert.ok(outgoingRequest.data.text);
  assert.ok(outgoingRequest.data.image_base64);
  assert.equal(queryCalls.length, 0);
});

test('harmful text plus normal image keeps combined block and is not delivered', async () => {
  const result = moderationResult({ textDecision: 'block', textScore: 0.96, imageDecision: 'allow', imageScore: 0.01, confidence: 0 });
  await harness({ content: 'kill him', image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, result);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.decision, 'block');
  assert.equal(response.body.delivered, false);
  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0][1][3], 'block');
  assert.equal(socketEvents.length, 0);
});

test('safe text plus warning weapon image returns moderation warning without delivery', async () => {
  const result = moderationResult({ textDecision: 'allow', textScore: 0.1, imageDecision: 'warn', imageScore: 0.55, confidence: 0.55 });
  await harness({ content: 'hello', image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, result);
  assert.equal(response.statusCode, 501);
  assert.equal(response.body.decision, 'warn');
  assert.equal(response.body.moderation.image.categories.weapons.detected, true);
  assert.equal(response.body.delivered, false);
});

test('moderation timeout fails closed without a database write', async () => {
  const error = new Error('timeout'); error.code = 'ECONNABORTED';
  await harness({ content: 'hello' }, null, error);
  assert.equal(response.statusCode, 504);
  assert.equal(response.body.delivered, false);
  assert.equal(queryCalls.length, 0);
  assert.equal(socketEvents.length, 0);
});

test('moderation service unavailable fails closed without a database write', async () => {
  const error = new Error('offline'); error.code = 'ECONNREFUSED';
  await harness({ content: 'hello' }, null, error);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.delivered, false);
  assert.equal(queryCalls.length, 0);
});

test('invalid image input is rejected without a database write', async () => {
  const error = new Error('invalid image'); error.response = { status: 400, data: { detail: 'bad base64' } };
  await harness({ image_base64: '%%%', mime_type: 'image/jpeg' }, null, error);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.delivered, false);
  assert.equal(queryCalls.length, 0);
});

test('invalid moderation response fails closed without a database write', async () => {
  await harness({ content: 'hello' }, { score: 0.1, decision: 'unknown' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.delivered, false);
  assert.equal(queryCalls.length, 0);
});

test('image-only request requires image mime type', async () => {
  await harness({ image_base64: 'aW1hZ2U=' }, null);
  assert.equal(response.statusCode, 400);
  assert.equal(queryCalls.length, 0);
});

