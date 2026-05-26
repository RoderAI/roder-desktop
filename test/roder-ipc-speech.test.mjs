import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/roder-ipc.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText;

function loadRoderIpc(request) {
  const module = { exports: {} };
  new Script(compiled).runInNewContext({
    exports: module.exports,
    module,
    window: {
      roderDesktop: {
        request,
      },
    },
  });
  return module.exports.roderIpc;
}

test("listSpeechProviders sends the speech/providers/list request to the app-server", async () => {
  const calls = [];
  const mockProviders = [
    { id: "openai-speech", name: "OpenAI Speech", recommended: true },
  ];
  const roderIpc = loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { providers: mockProviders };
  });

  const result = await roderIpc.listSpeechProviders();

  assert.deepEqual(result, { providers: mockProviders });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      method: "speech/providers/list",
      params: {},
    },
  ]);
});

test("transcribeSpeech sends the speech/transcribe request with correct parameters", async () => {
  const calls = [];
  const mockResult = {
    provider: "openai-speech",
    model: "whisper-1",
    text: "Hello world",
    segments: [],
  };
  const roderIpc = loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return mockResult;
  });

  const params = {
    provider: "openai-speech",
    model: "whisper-1",
    audio: {
      bytesBase64: "YXVkaW8=",
      mimeType: "audio/wav",
      filename: "test.wav",
    },
    language: "en",
    diarization: true,
  };

  const result = await roderIpc.transcribeSpeech(params);

  assert.deepEqual(result, mockResult);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      method: "speech/transcribe",
      params,
    },
  ]);
});
