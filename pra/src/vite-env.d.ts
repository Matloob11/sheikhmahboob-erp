/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_APP_BUILD_TIME: string;
  readonly VITE_DAFTAR_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
