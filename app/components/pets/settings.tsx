'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, Upload, RotateCcw, Check } from 'lucide-react';
import { Button } from '@/components/hub/shared';
import { PetFramePlayer } from './frame-player';
import { builtinPet } from '@/lib/pets/builtin';
import {
  defaultPetPreferences,
  PET_PREFERENCES_KEY,
  petStates,
  petStateLabels,
  type PetPack,
} from '@/lib/pets/contracts';
import { usePetPreferences } from '@/lib/pets/use-preferences';
import { readPetFile } from '@/lib/pets/import-client';
import { accountRepository } from '@/lib/repository';
export function PetSettings() {
  const [preferences, , saved] = usePetPreferences();
  const [candidate, setCandidate] = useState<PetPack | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null),
    request = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  const preview = candidate ?? preferences.custom ?? builtinPet;
  async function upload(file: File) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const pack = await readPetFile(file, controller.signal);
      if (alive.current && !controller.signal.aborted) {
        setCandidate(pack);
        setMessage('预览后可启用。');
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : '读取失败。');
    } finally {
      if (alive.current && !controller.signal.aborted) setBusy(false);
    }
  }
  async function enable() {
    const pack = candidate ?? preferences.custom;
    if (!pack) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (
        await saved.commit({ schemaVersion: 1, active: 'custom', custom: pack })
      ) {
        setCandidate(null);
        setMessage('已启用 ' + pack.name);
      } else setError('保存失败，请重试。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败。');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function restore() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!saved.ready) {
        await accountRepository.write([
          { key: PET_PREFERENCES_KEY, value: defaultPetPreferences },
        ]);
        await saved.retry();
      } else if (!(await saved.commit({ ...preferences, active: 'builtin' })))
        throw Error('保存失败，请重试。');
      setMessage('已恢复默认小猫。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败。');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="pet-settings" aria-label="桌宠设置">
      <div className="pet-settings-heading">
        <h3>桌宠</h3>
        <span>
          {saved.ready
            ? '当前：' +
              (preferences.active === 'custom'
                ? preferences.custom?.name
                : builtinPet.name)
            : saved.error
              ? '读取失败'
              : '正在读取…'}
        </span>
      </div>
      <div className="pet-settings-actions">
        <a
          className="button"
          href="/pets/template.zip"
          download="contexthub-pet-template.zip"
        >
          <Download size={15} />
          目录帧模板
        </a>
        <a
          className="button"
          href="/pets/codex-template.zip"
          download="contexthub-codex-pet.zip"
        >
          <Download size={15} />
          Codex 模板
        </a>
        <Button
          disabled={busy || !saved.ready}
          onClick={() => input.current?.click()}
        >
          <Upload size={15} />
          {busy ? '正在处理…' : '上传 ZIP'}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          hidden
          aria-label="上传桌宠 ZIP"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>
      {!saved.ready && saved.error && (
        <Button disabled={busy} onClick={() => void saved.retry()}>
          重试读取
        </Button>
      )}
      <p className="pet-format-hint">目录帧 / Codex 图集 · PNG / WebP</p>
      <div className="pet-pack-heading">
        <strong>{preview.name}</strong>
        {preview.source && (
          <span>Codex {preview.source === 'codex-v1' ? 'v1' : 'v2'}</span>
        )}
        {preview === builtinPet && <span>内置</span>}
      </div>
      <div className="pet-state-previews">
        {petStates.map((state) => (
          <div className="pet-state-preview" key={state}>
            <div className="pet-preview-stage">
              <PetFramePlayer pack={preview} state={state} />
            </div>
            <span>{petStateLabels[state]}</span>
            {!preview.animations[state] && <small>使用默认动画</small>}
          </div>
        ))}
      </div>
      <div className="pet-settings-actions">
        <Button
          primary
          disabled={
            busy ||
            !saved.ready ||
            (!candidate &&
              (!preferences.custom || preferences.active === 'custom'))
          }
          onClick={() => void enable()}
        >
          <Check size={15} />
          启用
        </Button>
        <Button
          disabled={
            busy ||
            (!saved.ready && !saved.error) ||
            (saved.ready && preferences.active === 'builtin')
          }
          onClick={() => void restore()}
        >
          <RotateCcw size={15} />
          恢复默认
        </Button>
      </div>
      {(error || saved.error) && (
        <p className="error-text" role="alert">
          {error || saved.error}
        </p>
      )}
      {message && <output>{message}</output>}
    </section>
  );
}
