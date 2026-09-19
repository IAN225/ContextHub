'use client';
import { usePersistent } from '../storage/use-persistent';
import { PET_PREFERENCES_KEY, defaultPetPreferences } from './contracts';
import { normalizePetPreferences } from './package';
export function usePetPreferences() {
  return usePersistent(PET_PREFERENCES_KEY, defaultPetPreferences, {
    normalize: normalizePetPreferences,
  });
}
