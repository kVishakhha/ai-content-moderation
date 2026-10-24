const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const imageStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-moderation-images-'));
process.env.IMAGE_STORAGE_DIR = imageStorageDir;
const fakePool = { query: async () => ({ rows: [{ id: 9, content: 'hello' }] }) };
const dbModule = require.resolve('../config/db');
require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: fakePool };
const axios = require('axios');
const { sendMessage, getImage } = require('../controllers/chatController');

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

function harness(body, result, postError, queryError) {
  queryCalls = [];
  socketEvents = [];
  outgoingRequest = null;
  fakePool.query = async (...args) => {
    queryCalls.push(args);
    if (queryError) throw queryError;
    const isImage = args[0].includes("VALUES ($1, $2, $3, 'image'");
    return { rows: [{
      id: 9,
      sender_id: 3,
      receiver_id: 4,
      content: body.content || null,
      message_type: isImage ? 'image' : 'text',
      image_url: isImage ? args[1][3] : null,
      mime_type: isImage ? args[1][4] : null,
      decision: isImage ? args[1][5] : args[1][3],
    }] };
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
  fs.rmSync(imageStorageDir, { recursive: true, force: true });
  fs.mkdirSync(imageStorageDir, { recursive: true });
  if (originalUrl === undefined) delete process.env.MODERATION_SERVICE_URL;
  else process.env.MODERATION_SERVICE_URL = originalUrl;
});

test.after(() => {
  fs.rmSync(imageStorageDir, { recursive: true, force: true });
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

test('allowed normal image is moderated, stored, and delivered', async () => {
  const image = moderationResult({ imageDecision: 'allow', imageScore: 0.01, confidence: 0 });
  await harness({ image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, image);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.decision, 'allow');
  assert.equal(response.body.delivered, true);
  assert.equal(queryCalls.length, 1);
  assert.equal(response.body.message.message_type, 'image');
  assert.equal(response.body.message.mime_type, 'image/jpeg');
  assert.match(response.body.message.image_url, /^\/chat\/media\/[0-9a-f-]{36}\.jpg$/);
  assert.deepEqual(
    fs.readFileSync(path.join(imageStorageDir, path.basename(response.body.message.image_url))),
    Buffer.from('image')
  );
  assert.equal(socketEvents.length, 1);
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
  assert.equal(queryCalls[0][1][5], 'block');
  assert.equal(queryCalls[0][1][2], null);
  assert.equal(queryCalls[0][1][3], null);
  assert.equal(queryCalls[0][1][4], 'image/jpeg');
  assert.equal(fs.readdirSync(imageStorageDir).length, 0);
  assert.equal(socketEvents.length, 0);
});

test('text plus normal image runs both pipelines and delivers the stored message', async () => {
  const result = moderationResult({ textDecision: 'allow', textScore: 0.1, imageDecision: 'allow', imageScore: 0.01, confidence: 0 });
  await harness({ content: 'hello', image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, result);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.decision, 'allow');
  assert.equal(response.body.delivered, true);
  assert.ok(outgoingRequest.data.text);
  assert.ok(outgoingRequest.data.image_base64);
  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0][1][2], 'hello');
  assert.equal(socketEvents.length, 1);
});

test('harmful text plus normal image keeps combined block and is not delivered', async () => {
  const result = moderationResult({ textDecision: 'block', textScore: 0.96, imageDecision: 'allow', imageScore: 0.01, confidence: 0 });
  await harness({ content: 'kill him', image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, result);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.decision, 'block');
  assert.equal(response.body.delivered, false);
  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0][1][5], 'block');
  assert.equal(socketEvents.length, 0);
});

test('safe text plus warning weapon image returns moderation warning without delivery', async () => {
  const result = moderationResult({ textDecision: 'allow', textScore: 0.1, imageDecision: 'warn', imageScore: 0.55, confidence: 0.55 });
  await harness({ content: 'hello', image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, result);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.decision, 'warn');
  assert.equal(response.body.moderation.image.categories.weapons.detected, true);
  assert.equal(response.body.delivered, true);
  assert.equal(socketEvents.length, 1);
});

test('image storage is cleaned up when the message insert fails', async () => {
  const image = moderationResult({ imageDecision: 'allow', imageScore: 0.01, confidence: 0 });
  await harness({ image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, image, null, new Error('database unavailable'));
  assert.equal(response.statusCode, 500);
  assert.equal(fs.readdirSync(imageStorageDir).length, 0);
  assert.equal(socketEvents.length, 0);
});

test('image endpoint returns stored bytes only to a message participant', async () => {
  const image = moderationResult({ imageDecision: 'allow', imageScore: 0.01, confidence: 0 });
  await harness({ image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, image);
  const imageUrl = response.body.message.image_url;
  fakePool.query = async () => ({ rows: [{ mime_type: 'image/jpeg' }] });
  const imageResponse = {
    headers: {},
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    send(data) { this.body = data; return this; },
  };
  await getImage({
    headers: { 'x-user-id': '4' },
    params: { filename: path.basename(imageUrl) },
  }, imageResponse);
  assert.equal(imageResponse.statusCode, 200);
  assert.equal(imageResponse.headers['Content-Type'], 'image/jpeg');
  assert.deepEqual(imageResponse.body, Buffer.from('image'));

  fakePool.query = async () => ({ rows: [] });
  const unauthorized = { ...imageResponse, headers: {} };
  await getImage({
    headers: { 'x-user-id': '99' },
    params: { filename: path.basename(imageUrl) },
  }, unauthorized);
  assert.equal(unauthorized.statusCode, 404);
});

test('admin can retrieve a non-blocked image for moderation review', async () => {
  const image = moderationResult({ imageDecision: 'warn', imageScore: 0.4, confidence: 0.4 });
  await harness({ image_base64: 'aW1hZ2U=', mime_type: 'image/jpeg' }, image);
  const imageUrl = response.body.message.image_url;
  fakePool.query = async (_sql, values) => {
    assert.equal(values[2], 'admin');
    return { rows: [{ mime_type: 'image/jpeg' }] };
  };
  const imageResponse = {
    headers: {},
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    send(data) { this.body = data; return this; },
  };
  await getImage({
    headers: { 'x-user-id': '99', 'x-user-role': 'admin' },
    params: { filename: path.basename(imageUrl) },
  }, imageResponse);
  assert.equal(imageResponse.statusCode, 200);
  assert.deepEqual(imageResponse.body, Buffer.from('image'));
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
