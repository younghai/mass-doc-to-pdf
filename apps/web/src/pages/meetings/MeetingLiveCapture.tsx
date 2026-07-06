import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { MeetingSpeechRecognition, RecordingState } from "./captureTypes";
import {
  appendTranscript,
  getSpeechRecognitionConstructor,
  selectAudioMimeType,
  stopStream,
} from "./captureUtils";
import { formatUpdatedAt, revokeObjectUrl } from "./utils";

interface MeetingLiveCaptureProps {
  readonly defaultTranscript: string;
  readonly setTranscript: Dispatch<SetStateAction<string>>;
  readonly setSourceFileName: Dispatch<SetStateAction<string>>;
}

export function MeetingLiveCapture({
  defaultTranscript,
  setTranscript,
  setSourceFileName,
}: MeetingLiveCaptureProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioFileName, setAudioFileName] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [speechSupported] = useState(() => getSpeechRecognitionConstructor() !== null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<MeetingSpeechRecognition | null>(null);
  const audioUrlRef = useRef("");

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      recognitionRef.current?.abort();
      stopStream(streamRef.current);
      revokeObjectUrl(audioUrlRef.current);
    },
    [],
  );

  async function handleStartRealtimeCapture() {
    setRecordingError("");
    setLiveTranscript("");

    if (typeof MediaRecorder === "undefined") {
      setRecordingError("이 브라우저는 실시간 녹음을 지원하지 않습니다.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError("마이크 접근 API를 사용할 수 없습니다.");
      return;
    }

    try {
      setTranscript((current) => (current.trim() === defaultTranscript ? "" : current));
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = selectAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const recordedMimeType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: recordedMimeType });
        const nextUrl = URL.createObjectURL(blob);
        const fileName = `live-meeting-${new Date().toISOString().replace(/[:.]/gu, "-")}.webm`;
        replaceAudioUrl(nextUrl);
        setAudioFileName(fileName);
        setSourceFileName(fileName);
        setRecordingState("idle");
        setRecordingStartedAt(null);
        stopStream(streamRef.current);
        streamRef.current = null;
        recorderRef.current = null;
      };

      recorder.start(1000);
      recorderRef.current = recorder;
      setRecordingStartedAt(new Date().toISOString());
      setRecordingState("recording");
      startLiveTranscription();
    } catch (error) {
      setRecordingState("idle");
      stopStream(streamRef.current);
      streamRef.current = null;
      setRecordingError(error instanceof Error ? error.message : "마이크 녹음을 시작하지 못했습니다.");
    }
  }

  function handleStopRealtimeCapture() {
    setRecordingState("stopping");
    stopLiveTranscription();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    setRecordingState("idle");
  }

  function startLiveTranscription() {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setLiveTranscript("");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "ko-KR";
    recognition.onresult = (event) => {
      const finalSegments: string[] = [];
      const interimSegments: string[] = [];

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript.trim();
        if (!result || !text) continue;
        if (result.isFinal) finalSegments.push(text);
        else interimSegments.push(text);
      }

      if (finalSegments.length > 0) {
        setTranscript((current) => appendTranscript(current, finalSegments.join("\n"), defaultTranscript));
      }
      setLiveTranscript(interimSegments.join(" "));
    };
    recognition.onerror = (event) => {
      setRecordingError(`실시간 전사 오류: ${event.message ?? event.error}`);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setLiveTranscript("");
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : "실시간 전사를 시작하지 못했습니다.");
    }
  }

  function stopLiveTranscription() {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onend = null;
    recognition.stop();
    recognitionRef.current = null;
    setLiveTranscript("");
  }

  function replaceAudioUrl(nextUrl: string) {
    revokeObjectUrl(audioUrlRef.current);
    audioUrlRef.current = nextUrl;
    setAudioUrl(nextUrl);
  }

  const recordingLabel =
    recordingState === "recording" ? "녹음 중" : recordingState === "stopping" ? "저장 중" : "대기";
  const recordingButtonLabel =
    recordingState === "recording"
      ? "녹음 중지"
      : recordingState === "stopping"
        ? "녹음 저장 중"
        : "실시간 녹음 시작";

  return (
    <section className="meeting-live-capture" aria-label="실시간 녹음 및 전사">
      <div className="meeting-live-head">
        <div>
          <strong>실시간 녹음</strong>
          <p>
            전사 {speechSupported ? "사용 가능" : "브라우저 미지원"}
            {recordingStartedAt ? ` · 시작 ${formatUpdatedAt(recordingStartedAt)}` : ""}
          </p>
        </div>
        <span className={recordingState === "recording" ? "mini-pill running" : "mini-pill"}>
          {recordingLabel}
        </span>
      </div>
      <div className="meeting-live-actions">
        <button
          className={recordingState === "recording" ? "btn danger" : "btn"}
          type="button"
          disabled={recordingState === "stopping"}
          onClick={recordingState === "recording" ? handleStopRealtimeCapture : handleStartRealtimeCapture}
        >
          {recordingButtonLabel}
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={recordingState === "recording"}
          onClick={() => setTranscript("")}
        >
          전사 비우기
        </button>
      </div>
      {liveTranscript && (
        <p className="live-transcript" aria-live="polite">
          {liveTranscript}
        </p>
      )}
      {audioUrl && (
        <div className="meeting-audio-review">
          <audio controls src={audioUrl}>
            <track kind="captions" />
          </audio>
          <a className="btn secondary" href={audioUrl} download={audioFileName}>
            녹음 다운로드
          </a>
        </div>
      )}
      {recordingError && (
        <p className="error" role="alert">
          {recordingError}
        </p>
      )}
    </section>
  );
}
