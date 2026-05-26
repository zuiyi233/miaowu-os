import type {
  TtsCacheState,
  TtsChapterAudioManifest,
  TtsErrorCode,
  TtsJob,
  TtsNarrationMode,
  TtsNarrationPlan,
  TtsProviderError,
  TtsProviderStatus,
  TtsSpeakerVoiceMapping,
  TtsAdvancedOptions,
  TtsProvider,
} from './api';
import type { NativeTtsVoice } from './nativeSpeech';

export type TtsPlaybackEngine = 'device' | 'server';

export interface UseTtsOptions {
  provider?: TtsProvider;
  voice?: string;
  model?: string;
  fmt?: string;
  speed?: number;
  instructions?: string;
  advancedOptions?: TtsAdvancedOptions;
  narrationMode?: TtsNarrationMode;
  speakerVoices?: TtsSpeakerVoiceMapping;
  playbackEngine?: TtsPlaybackEngine;
  nativeVoiceId?: string;
  nativeRate?: number;
  nativePitch?: number;
}

export interface TtsState {
  playing: boolean;
  loading: boolean;
  error: string | null;
  errorCode: TtsErrorCode | string | null;
  progress: number;
  duration: number;
  currentTime: number;
  status: TtsProviderStatus | null;
  smoke: TtsProviderStatus | null;
  providerError: TtsProviderError | null;
  chapterAudio: TtsChapterAudioManifest | null;
  chapterLoading: boolean;
  chapterGenerating: boolean;
  chapterJob: TtsJob | null;
  chapterCacheState: TtsCacheState;
  downloadUrl: string | null;
  narrationMode: TtsNarrationMode;
  narrationPlan: TtsNarrationPlan | null;
  narrationPlanLoading: boolean;
  narrationPlanGenerating: boolean;
  speakerVoices: TtsSpeakerVoiceMapping;
  playbackEngine: TtsPlaybackEngine;
  nativeSupported: boolean;
  nativeVoices: NativeTtsVoice[];
  nativeVoiceId?: string;
  nativeRate: number;
  nativePitch: number;
  browserExporting: boolean;
  browserExportSupported: boolean;
  browserExportAvailable: boolean;
}

export const INITIAL_STATE: TtsState = {
  playing: false,
  loading: false,
  error: null,
  errorCode: null,
  progress: 0,
  duration: 0,
  currentTime: 0,
  status: null,
  smoke: null,
  providerError: null,
  chapterAudio: null,
  chapterLoading: false,
  chapterGenerating: false,
  chapterJob: null,
  chapterCacheState: 'unknown',
  downloadUrl: null,
  narrationMode: 'single_narrator',
  narrationPlan: null,
  narrationPlanLoading: false,
  narrationPlanGenerating: false,
  speakerVoices: {},
  playbackEngine: 'server',
  nativeSupported: false,
  nativeVoices: [],
  nativeVoiceId: undefined,
  nativeRate: 1,
  nativePitch: 1,
  browserExporting: false,
  browserExportSupported: false,
  browserExportAvailable: false,
};
