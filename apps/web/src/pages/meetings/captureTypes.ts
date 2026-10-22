export type RecordingState = "idle" | "recording" | "stopping";

export interface MeetingSpeechAlternative {
  readonly transcript: string;
}

export interface MeetingSpeechResult {
  readonly isFinal: boolean;
  readonly [index: number]: MeetingSpeechAlternative | undefined;
}

export interface MeetingSpeechResultList {
  readonly length: number;
  readonly [index: number]: MeetingSpeechResult | undefined;
}

export interface MeetingSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: MeetingSpeechResultList;
}

export interface MeetingSpeechRecognitionErrorEvent {
  readonly error: string;
  readonly message?: string;
}

export interface MeetingSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: MeetingSpeechRecognitionEvent) => void) | null;
  onerror: ((event: MeetingSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface MeetingSpeechRecognitionConstructor {
  new (): MeetingSpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: MeetingSpeechRecognitionConstructor;
    webkitSpeechRecognition?: MeetingSpeechRecognitionConstructor;
  }
}

export const AUDIO_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;
