import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.beatsync.ai',
  appName: 'BeatSync AI',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
};

export default config;
