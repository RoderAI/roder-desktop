import { expect, test, vi } from "vitest";

async function loadRoderIpc(request) {
  vi.resetModules();
  globalThis.window = {
    roderDesktop: {
      request,
      onNotification: () => () => undefined,
      onStderr: () => () => undefined,
    },
  };
  return (await import("../src/lib/roder-ipc")).roderIpc;
}

test("listSpeechProviders sends the speech/providers/list request to the app-server", async () => {
  const calls = [];
  const mockProviders = [{ id: "openai-speech", name: "OpenAI Speech", recommended: true }];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { providers: mockProviders };
  });

  const result = await roderIpc.listSpeechProviders();

  expect(result).toEqual({ providers: mockProviders });
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
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
  const roderIpc = await loadRoderIpc(async (method, params) => {
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

  expect(result).toEqual(mockResult);
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "speech/transcribe",
      params,
    },
  ]);
});
