import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getFeatureChoice,
  setFeatureChoice,
  clearFeatureChoice,
} from './featureSelection';

describe('featureSelection service', () => {
  beforeEach(() => {
    localStorage.clear();
    clearFeatureChoice('chat');
    clearFeatureChoice('model3d');
    clearFeatureChoice('vfx');
  });

  it('defaults to inherit when no saved preference exists', () => {
    expect(getFeatureChoice('chat')).toBe('inherit');
    expect(getFeatureChoice('model3d')).toBe('inherit');
  });

  it('saves and restores choice per feature key', () => {
    setFeatureChoice('chat', 'account-123');
    setFeatureChoice('model3d', 'local');

    expect(getFeatureChoice('chat')).toBe('account-123');
    expect(getFeatureChoice('model3d')).toBe('local');
    expect(getFeatureChoice('vfx')).toBe('inherit');
  });

  it('persists preferences to localStorage', () => {
    setFeatureChoice('chat', 'account-custom');
    expect(localStorage.getItem('forgekit:feature-provider-choice:chat')).toBe('account-custom');
  });

  it('clears choice properly', () => {
    setFeatureChoice('chat', 'account-custom');
    clearFeatureChoice('chat');
    expect(getFeatureChoice('chat')).toBe('inherit');
    expect(localStorage.getItem('forgekit:feature-provider-choice:chat')).toBeNull();
  });
});
