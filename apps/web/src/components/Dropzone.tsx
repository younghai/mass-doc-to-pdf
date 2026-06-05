import { useRef, useState } from "react";
import { ACCEPTED_EXTENSIONS } from "../api/client";

export function Dropzone({
  onFile,
  disabled,
}: {
  onFile: (f: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      className={`dropzone ${over ? "over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        data-testid="file-input"
        style={{ display: "none" }}
        accept={ACCEPTED_EXTENSIONS.join(",")}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <p>파일을 끌어다 놓거나 클릭하여 선택</p>
      <small>지원 형식: hwp, hwpx, docx, xlsx, pptx …</small>
    </div>
  );
}
