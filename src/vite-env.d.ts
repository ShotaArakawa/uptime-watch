/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Workers の API の URL。未設定ならブラウザ内のデモモードで動く */
  readonly VITE_API_BASE?: string;
}
