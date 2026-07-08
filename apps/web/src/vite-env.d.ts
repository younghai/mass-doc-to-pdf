/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_MEETINGS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
