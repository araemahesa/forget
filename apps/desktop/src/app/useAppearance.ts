import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'dark' | 'light';
export type DensityPreference = 'comfortable' | 'compact';

function stored(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function persist(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Session preferences still work. */ }
}

export function useAppearance() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const value = stored('forgekit-theme');
    return value === 'dark' || value === 'light' || value === 'system' ? value : 'dark';
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true);
  const [reduceMotion, setReduceMotion] = useState(() => stored('forgekit-motion') === 'reduce');
  const [density, setDensity] = useState<DensityPreference>(() => stored('forgekit-density') === 'compact' ? 'compact' : 'comfortable');
  const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const change = () => setSystemDark(media.matches);
    change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persist('forgekit-theme', preference);
  }, [theme, preference]);
  useEffect(() => {
    document.documentElement.dataset.motion = reduceMotion ? 'reduce' : 'system';
    persist('forgekit-motion', reduceMotion ? 'reduce' : 'system');
  }, [reduceMotion]);
  useEffect(() => {
    document.documentElement.dataset.density = density;
    persist('forgekit-density', density);
  }, [density]);

  return { theme, preference, setPreference, reduceMotion, setReduceMotion, density, setDensity };
}
