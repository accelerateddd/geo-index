import React, { useState } from 'react';
import {
  FileUp,
  PlusCircle,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Download,
  Upload,
  Copy,
  ClipboardPaste,
} from 'lucide-react';
import type { QuizCategory, QuizConfig, QuizAttempt } from '../types/quiz';
import { saveCustomGeoJson, saveCustomQuizMeta } from '../utils/storage';

interface QuizBuilderModalProps {
  customQuizzes: QuizConfig[];
  attempts: QuizAttempt[];
  enrolledIds: string[];
  onQuizCreated: (updatedCustomQuizzes: QuizConfig[], newQuizId: string, enrollImmediately: boolean) => void;
  onDeleteCustomQuiz: (quizId: string) => void;
  onImportBackup: (attempts: QuizAttempt[], customQuizzes: QuizConfig[], enrolledIds?: string[]) => void;
}

export const QuizBuilderTab: React.FC<QuizBuilderModalProps> = ({
  customQuizzes,
  attempts,
  enrolledIds,
  onQuizCreated,
  onDeleteCustomQuiz,
  onImportBackup,
}) => {
  const [title, setTitle] = useState('');
  const [countryOrRegion, setCountryOrRegion] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [category, setCategory] = useState<QuizCategory>('niche-subdivisions');
  const [geoJsonData, setGeoJsonData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [availableProps, setAvailableProps] = useState<string[]>([]);
  const [selectedNameProp, setSelectedNameProp] = useState('');
  const [filterProp, setFilterProp] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const [enrollOnCreate, setEnrollOnCreate] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [syncCodeInput, setSyncCodeInput] = useState('');

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccessMsg(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(String(event.target?.result));
        if (!parsed || parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
          throw new Error('File must be a GeoJSON FeatureCollection.');
        }
        if (parsed.features.length === 0) {
          throw new Error('GeoJSON has 0 features.');
        }
        const firstProps = parsed.features[0].properties || {};
        const keys = Object.keys(firstProps);
        if (keys.length === 0) {
          throw new Error('GeoJSON features have no properties.');
        }

        setGeoJsonData(parsed);
        setAvailableProps(keys);

        const preferred = keys.find((k) =>
          /^(adm2_name|name|shapeName|NAME_1|NAME_2|STATE_NAME|suburb|LOC_NAME|admin|nom)$/i.test(k)
        );
        setSelectedNameProp(preferred || keys[0]);

        if (!title) {
          setTitle(file.name.replace(/\.(geo)?json$/i, '').replace(/[-_]/g, ' '));
        }
      } catch (err: any) {
        setError(err.message || 'Could not parse GeoJSON');
        setGeoJsonData(null);
      }
    };
    reader.readAsText(file);
  }

  async function handleCreateQuiz(e: React.FormEvent) {
    e.preventDefault();
    if (!geoJsonData || !selectedNameProp || !title.trim()) {
      setError('Required: Title, GeoJSON file, and Name Property.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      let activeFeatures = geoJsonData.features;
      if (filterProp && filterVal.trim()) {
        activeFeatures = activeFeatures.filter(
          (f) =>
            String(f.properties?.[filterProp] || '').trim().toLowerCase() ===
            filterVal.trim().toLowerCase()
        );
      }

      const uniqueNames = new Set(
        activeFeatures
          .map((f) => String(f.properties?.[selectedNameProp] || '').trim())
          .filter(Boolean)
      );

      if (uniqueNames.size === 0) {
        throw new Error(`0 features matched property "${selectedNameProp}".`);
      }

      const parsedTags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const id = `custom-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;
      const newQuiz: QuizConfig = {
        id,
        title: title.trim(),
        category,
        countryOrRegion: countryOrRegion.trim() || 'Custom',
        nameProperty: selectedNameProp,
        filterProperty: filterProp || undefined,
        filterValue: filterVal.trim() || undefined,
        defaultCenter: [0, 0],
        defaultZoom: 5,
        totalItems: uniqueNames.size,
        tags: parsedTags,
        isCustom: true,
      };

      await saveCustomGeoJson(id, geoJsonData);
      const updatedMeta = saveCustomQuizMeta(newQuiz);
      onQuizCreated(updatedMeta, id, enrollOnCreate);

      setSuccessMsg(`Saved "${newQuiz.title}" (${uniqueNames.size} items).`);
      setTitle('');
      setCountryOrRegion('');
      setTagsInput('');
      setFilterProp('');
      setFilterVal('');
      setGeoJsonData(null);
      setAvailableProps([]);
    } catch (err: any) {
      setError(err.message || 'Failed to save quiz');
    } finally {
      setSaving(false);
    }
  }

  function handleExportProgress() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      enrolledIds,
      attempts,
      customQuizzes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `geoquiz-state-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportBackupFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(String(event.target?.result));
        if (!Array.isArray(parsed.attempts)) {
          throw new Error('Invalid state JSON.');
        }
        onImportBackup(parsed.attempts, parsed.customQuizzes || [], parsed.enrolledIds);
        setSuccessMsg(`Imported ${parsed.attempts.length} attempts.`);
      } catch (err: any) {
        setError(err.message || 'Failed to import JSON');
      }
    };
    reader.readAsText(file);
  }

  function handleCopySyncCode() {
    setError(null);
    const payload = {
      v: 1,
      enrolledIds,
      attempts,
      customQuizzes,
    };
    const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
    navigator.clipboard
      .writeText(encoded)
      .then(() => {
        setSuccessMsg('Copied sync code to clipboard! Paste it on your phone or PC to sync.');
      })
      .catch(() => {
        setSyncCodeInput(encoded);
        setSuccessMsg('Generated sync code below — copy it to transfer across devices.');
      });
  }

  function handleApplySyncCode() {
    setError(null);
    const trimmed = syncCodeInput.trim();
    if (!trimmed) return;
    try {
      const jsonStr = decodeURIComponent(atob(trimmed));
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed.attempts)) {
        throw new Error('Invalid sync code format.');
      }
      onImportBackup(parsed.attempts, parsed.customQuizzes || [], parsed.enrolledIds);
      setSyncCodeInput('');
      setSuccessMsg(
        `Synced ${parsed.attempts.length} attempts & ${(parsed.enrolledIds || []).length} queued quizzes!`
      );
    } catch (err: any) {
      setError('Invalid sync code. Make sure you copied the full string.');
    }
  }

  const samplePreviewNames =
    geoJsonData && selectedNameProp
      ? Array.from(
          new Set(
            geoJsonData.features
              .filter((f) =>
                filterProp && filterVal.trim()
                  ? String(f.properties?.[filterProp] || '').trim().toLowerCase() ===
                    filterVal.trim().toLowerCase()
                  : true
              )
              .map((f) => String(f.properties?.[selectedNameProp] || '').trim())
              .filter(Boolean)
          )
        ).slice(0, 15)
      : [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-6 font-mono">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="text-xs font-bold text-slate-300 border-b border-slate-800 pb-2.5 mb-4">
          IMPORT_GEOJSON_QUIZ
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-2.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleCreateQuiz} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">GEOJSON_FILE</label>
              <label className="flex items-center justify-center gap-2 px-3 py-2 rounded border border-dashed border-slate-700 hover:border-indigo-500 bg-slate-950 text-slate-300 cursor-pointer transition">
                <FileUp className="w-3.5 h-3.5 text-indigo-400" />
                <span>
                  {geoJsonData
                    ? `${geoJsonData.features.length} features loaded`
                    : 'Select .geojson / .json'}
                </span>
                <input
                  type="file"
                  accept=".geojson,.json,application/json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">NAME_PROPERTY</label>
              <select
                value={selectedNameProp}
                onChange={(e) => setSelectedNameProp(e.target.value)}
                disabled={availableProps.length === 0}
                className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-white disabled:opacity-50 outline-none focus:border-indigo-500"
              >
                {availableProps.length === 0 ? (
                  <option value="">—</option>
                ) : (
                  availableProps.map((prop) => (
                    <option key={prop} value={prop}>
                      {prop}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">FILTER_PROPERTY (OPTIONAL)</label>
              <select
                value={filterProp}
                onChange={(e) => setFilterProp(e.target.value)}
                disabled={availableProps.length === 0}
                className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-white disabled:opacity-50 outline-none focus:border-indigo-500"
              >
                <option value="">None (use all features)</option>
                {availableProps.map((prop) => (
                  <option key={prop} value={prop}>
                    {prop}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">FILTER_VALUE (OPTIONAL)</label>
              <input
                type="text"
                value={filterVal}
                onChange={(e) => setFilterVal(e.target.value)}
                disabled={!filterProp}
                placeholder="e.g., Central"
                className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-white disabled:opacity-50 outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {samplePreviewNames.length > 0 && (
            <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
              <div className="text-[11px] text-slate-500 mb-1">
                PREVIEW [{samplePreviewNames.length} shown]:
              </div>
              <div className="flex flex-wrap gap-1">
                {samplePreviewNames.map((name) => (
                  <span
                    key={name}
                    className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 text-[11px]"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-slate-400 mb-1">TITLE</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Quiz title"
                className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-white outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">REGION_CODE</label>
              <input
                type="text"
                value={countryOrRegion}
                onChange={(e) => setCountryOrRegion(e.target.value)}
                placeholder="e.g. AUS / USA"
                className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-white outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">CATEGORY</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as QuizCategory)}
                className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-white outline-none focus:border-indigo-500"
              >
                <option value="niche-subdivisions">niche-subdivisions</option>
                <option value="subdivisions">subdivisions</option>
                <option value="cities">cities</option>
                <option value="landscapes">landscapes</option>
                <option value="flags">flags</option>
                <option value="leisure">leisure</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <div>
              <label className="block text-slate-400 mb-1">TECHNICAL_TAGS (COMMA SEPARATED)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. AUS, SAL, VIC"
                className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-white outline-none focus:border-indigo-500"
              />
            </div>

            <label className="flex items-center gap-2 pt-4 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={enrollOnCreate}
                onChange={(e) => setEnrollOnCreate(e.target.checked)}
                className="accent-indigo-500"
              />
              <span>Enroll directly into Revision Queue</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={saving || !geoJsonData}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold transition cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            {saving ? 'SAVING...' : 'CREATE QUIZ'}
          </button>
        </form>
      </div>

      {customQuizzes.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2 text-xs">
          <div className="font-bold text-slate-300 border-b border-slate-800 pb-2">
            CUSTOM_QUIZZES ({customQuizzes.length})
          </div>
          <div className="divide-y divide-slate-800">
            {customQuizzes.map((q) => (
              <div key={q.id} className="py-2.5 flex items-center justify-between gap-4">
                <div>
                  <span className="font-bold text-white">{q.title}</span>
                  <span className="text-slate-500 ml-2">
                    [{q.totalItems} items • prop: {q.nameProperty}]
                  </span>
                </div>
                <button
                  onClick={() => onDeleteCustomQuiz(q.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  DELETE
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 text-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="font-bold text-slate-300">STATE_SNAPSHOT_IO (PC ↔ MOBILE SYNC)</div>
            <div className="text-slate-500 mt-0.5">
              {attempts.length} logged runs • {enrolledIds.length} enrolled in queue (stored locally in browser)
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopySyncCode}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              COPY SYNC CODE
            </button>

            <button
              type="button"
              onClick={handleExportProgress}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              EXPORT JSON
            </button>

            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span>IMPORT JSON</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleImportBackupFile}
                className="hidden"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-3 border-t border-slate-800">
          <input
            type="text"
            value={syncCodeInput}
            onChange={(e) => setSyncCodeInput(e.target.value)}
            placeholder="Paste sync code from another device here..."
            className="flex-1 px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-base sm:text-xs text-white outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={handleApplySyncCode}
            disabled={!syncCodeInput.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold cursor-pointer shrink-0"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            LOAD SYNC CODE
          </button>
        </div>
      </div>
    </div>
  );
};
