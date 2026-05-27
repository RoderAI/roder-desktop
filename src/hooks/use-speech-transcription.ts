import { useCallback, useRef, useState, type RefCallback } from "react";
import { roderIpc } from "@/lib/roder-ipc";

type UseSpeechTranscriptionOptions = {
  onTranscriptionText: (text: string) => void;
};

type UseSpeechTranscriptionResult = {
  isRecording: boolean;
  isTranscribing: boolean;
  recordingError: string | null;
  clearRecordingError: () => void;
  lifecycleRef: RefCallback<HTMLElement>;
  toggleRecording: () => void;
};

export function useSpeechTranscription({
  onTranscriptionText,
}: UseSpeechTranscriptionOptions): UseSpeechTranscriptionResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mountedRef = useRef(false);

  const clearRecordingError = useCallback(() => setRecordingError(null), []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const lifecycleRef = useCallback<RefCallback<HTMLElement>>((node) => {
    mountedRef.current = node !== null;
    if (node || !mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return;
    }
    mediaRecorderRef.current.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setRecordingError(null);
    let stream: MediaStream | null = null;
    try {
      if (typeof MediaRecorder === "undefined") {
        throw new Error("Media recording is not available in this environment");
      }

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mimeType = preferredAudioMimeType();
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      const recordingStream = stream;
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        stopTracks(recordingStream);
        mediaRecorderRef.current = null;

        if (!mountedRef.current) {
          return;
        }

        setIsTranscribing(true);
        try {
          const result = await roderIpc.transcribeSpeech({
            audio: {
              bytesBase64: await blobToBase64(audioBlob),
              mimeType,
              filename: filenameForMimeType(mimeType),
            },
          });

          const text = result.text.trim();
          if (mountedRef.current && text) {
            onTranscriptionText(text);
          }
        } catch (error) {
          console.error("Transcription failed:", error);
          if (mountedRef.current) {
            setRecordingError(`Transcription failed: ${(error as Error).message}`);
          }
        } finally {
          if (mountedRef.current) {
            setIsTranscribing(false);
          }
        }
      };

      mediaRecorder.start();
      stream = null;
      if (mountedRef.current) {
        setIsRecording(true);
      }
    } catch (error) {
      stopTracks(stream);
      console.error("Microphone access failed:", error);
      if (mountedRef.current) {
        setRecordingError(`Microphone access failed: ${(error as Error).message}`);
      }
    }
  }, [onTranscriptionText]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
      return;
    }
    void startRecording();
  }, [isRecording, startRecording, stopRecording]);

  return {
    isRecording,
    isTranscribing,
    recordingError,
    clearRecordingError,
    lifecycleRef,
    toggleRecording,
  };
}

function preferredAudioMimeType(): string {
  for (const mimeType of ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"]) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return "audio/webm";
}

function filenameForMimeType(mimeType: string): string {
  if (mimeType.includes("webm")) {
    return "recording.webm";
  }
  if (mimeType.includes("mp4")) {
    return "recording.mp4";
  }
  if (mimeType.includes("ogg")) {
    return "recording.ogg";
  }
  return "recording.wav";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = (reader.result as string).split(",")[1] ?? "";
      resolve(base64data);
    };
    reader.onerror = reject;
  });
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
