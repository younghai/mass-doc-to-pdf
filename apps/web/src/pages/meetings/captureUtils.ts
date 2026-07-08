import { AUDIO_MIME_TYPES, type MeetingSpeechRecognitionConstructor } from "./captureTypes";

export function getSpeechRecognitionConstructor(): MeetingSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function selectAudioMimeType(): string {
  return AUDIO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function appendTranscript(current: string, addition: string, defaultTranscript: string): string {
  const cleanAddition = addition.trim();
  if (!cleanAddition) return current;
  const cleanCurrent = current.trim() === defaultTranscript ? "" : current.trimEnd();
  return cleanCurrent ? `${cleanCurrent}\n${cleanAddition}` : cleanAddition;
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
