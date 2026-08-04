export type MediaKind =
  | "embedding"
  | "image"
  | "imageToText"
  | "tts"
  | "stt"
  | "webSearch"
  | "webFetch"
  | "video"
  | "music"
  | "ocr"
  | "rerank"
  | "moderation"
  | "audioTranslation";

export const MEDIA_KINDS: MediaKind[] = [
  "embedding",
  "image",
  "imageToText",
  "tts",
  "stt",
  "webSearch",
  "webFetch",
  "video",
  "music",
  "ocr",
  "rerank",
  "moderation",
  "audioTranslation",
];
