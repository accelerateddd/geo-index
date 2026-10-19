import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Download,
  FileUp,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { QuizAttempt, QuizCategory, QuizConfig } from '../types/quiz';
import { saveCustomGeoJson, saveCustomQuizMeta } from '../utils/storage';
import {
  CATEGORY_ORDER,
  categoryLabel,
  cleanQuizTitle,
  itemCountLabel,
} from '../utils/quizDisplay';

interface QuizBuilderTabProps {
  customQuizzes: QuizConfig[];
  attempts: QuizAttempt[];
  enrolledIds: string[];
  onQuizCreated: (
    updatedCustomQuizzes: QuizConfig[],
    newQuizId: string,
    enrollImmediately: boolean
  ) => void;
  onDeleteCustomQuiz: (quizId: string) => void;
  onImportBackup: (
    attempts: QuizAttempt[],
    customQuizzes: QuizConfig[],
    enrolledIds?: string[]
  ) => void;
}

const inputClass =
  'w-full px-3 py-2 rounded bg-ink-950 border border-ink-800 text-base sm:text-xs text-white outline-none focus:border-accent-500 disabled:opacity-50';

const labelClass = 'mb-1 block text-[11px] uppercase tracking-wide text-ink-400';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function QuizBuilderTab({
  customQuizzes,
  attempts,
  enrolledIds,
  onQuizCreated,
  onDeleteCustomQuiz,
  onImportBackup,
}: QuizBuilderTabProps) {
  const [title, setTitle] = useState('');
  const [countryOrRegion, setCountryOrRegion] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [category, setCategory] = useState<QuizCategory>('niche-subdivisions');
  const [geoJsonData, setGeoJsonData] = useState<GeoJSON.FeatureCollection | null>(
    null
  );
  const [availableProps, setAvailableProps] = useState<string[]>([]);
  const [selectedNameProp, setSelectedNameProp] = useState('');
  const [filterProp, setFilterProp] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const [enrollOnCreate, setEnrollOnCreate] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [syncCodeInput, setSyncCodeInput] = useState('');

  function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccessMsg(null);

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      try {
        const parsed = JSON.parse(String(readerEvent.target?.result));
        if (!parsed || parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
          throw new Error('That file is not a GeoJSON FeatureCollection.');
        }
        if (parsed.features.length === 0) {
          throw new Error('That file has no features.');
        }

        const firstProps = parsed.features[0].properties || {};
        const keys = Object.keys(firstProps);
        if (keys.length === 0) {
          throw new Error('The features in that file have no properties.');
        }

        setGeoJsonData(parsed);
        setAvailableProps(keys);

        const preferred = keys.find((key) =>
          /^(adm2_name|name|shapeName|NAME_1|NAME_2|STATE_NAME|suburb|LOC_NAME|admin|nom)$/i.test(
            key
          )
        );
        setSelectedNameProp(preferred || keys[0]);

        if (!title) {
          setTitle(
            file.name
              .replace(/\.(geo)?json$/i, '')
              .replace(/[-_]/g, ' ')
              .trim()
          );
        }
      } catch (uploadError) {
        setError(errorMessage(uploadError, 'Could not read that GeoJSON file.'));
        setGeoJsonData(null);
        setAvailableProps([]);
      }
    };
    reader.readAsText(file);
  }

  async function handleCreateQuiz(event: FormEvent) {
    event.preventDefault();
    if (!geoJsonData || !selectedNameProp || !title.trim()) {
      setError('Add a title, a GeoJSON file, and the property that names each place.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let activeFeatures = geoJsonData.features;
      if (filterProp && filterVal.trim()) {
        activeFeatures = activeFeatures.filter(
          (feature) =>
            String(feature.properties?.[filterProp] || '')
              .trim()
              .toLowerCase() === filterVal.trim().toLowerCase()
        );
      }

      const uniqueNames = new Set(
        activeFeatures
          .map((feature) => String(feature.properties?.[selectedNameProp] || '').trim())
          .filter(Boolean)
      );

      if (uniqueNames.size === 0) {
        throw new Error(`No features matched the property "${selectedNameProp}".`);
      }

      const parsedTags = tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

      const id = `custom-${title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;

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

      setSuccessMsg(
        `"${newQuiz.title}" is ready — ${uniqueNames.size} places to practise.`
      );
      setTitle('');
      setCountryOrRegion('');
      setTagsInput('');
      setFilterProp('');
      setFilterVal('');
      setEnrollOnCreate(false);
      setGeoJsonData(null);
      setAvailableProps([]);
      setSelectedNameProp('');
    } catch (createError) {
      setError(errorMessage(createError, 'Could not create that quiz.'));
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
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `geo-index-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleImportBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      try {
        const parsed = JSON.parse(String(readerEvent.target?.result));
        if (!Array.isArray(parsed.attempts)) {
          throw new Error('That file is not a Geo Index backup.');
        }
        onImportBackup(parsed.attempts, parsed.customQuizzes || [], parsed.enrolledIds);
        setError(null);
        setSuccessMsg(`Restored ${parsed.attempts.length} practice runs.`);
      } catch (importError) {
        setError(errorMessage(importError, 'Could not import that backup.'));
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
        setSuccessMsg('Sync code copied. Paste it on your other device from Create.');
      })
      .catch(() => {
        setSyncCodeInput(encoded);
        setSuccessMsg('Sync code generated below — copy it to your other device.');
      });
  }

  function handleApplySyncCode() {
    setError(null);
    const trimmed = syncCodeInput.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(decodeURIComponent(atob(trimmed)));
      if (!Array.isArray(parsed.attempts)) {
        throw new Error('Invalid sync code.');
      }
      onImportBackup(parsed.attempts, parsed.customQuizzes || [], parsed.enrolledIds);
      setSyncCodeInput('');
      setSuccessMsg(
        `Loaded ${parsed.attempts.length} runs and ${
          (parsed.enrolledIds || []).length
        } queued quizzes.`
      );
    } catch {
      setError('That sync code could not be read. Make sure you copied all of it.');
    }
  }

  const samplePreviewNames =
    geoJsonData && selectedNameProp
      ? Array.from(
          new Set(
            geoJsonData.features
              .filter((feature) =>
                filterProp && filterVal.trim()
                  ? String(feature.properties?.[filterProp] || '')
                      .trim()
                      .toLowerCase() === filterVal.trim().toLowerCase()
                  : true
              )
              .map((feature) => String(feature.properties?.[selectedNameProp] || '').trim())
              .filter(Boolean)
          )
        ).slice(0, 15)
      : [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 font-mono">
      <div className="space-y-6">
        <section className="bg-ink-900 border border-ink-800 rounded-xl p-5">
          <div className="text-xs font-bold text-ink-300 border-b border-ink-800 pb-2.5 mb-4">
            IMPORT GEOJSON QUIZ
          </div>
          <p className="mb-4 text-xs leading-5 text-ink-500">
            Upload a FeatureCollection once. Geo Index reads the names from the
            property you choose, so the same file can power several quizzes.
          </p>

          {error ? (
            <div
              role="alert"
              className="mb-4 p-2.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {successMsg ? (
            <div
              role="status"
              className="mb-4 p-2.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          ) : null}

          <form onSubmit={handleCreateQuiz} className="space-y-4 text-xs">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className={labelClass}>GeoJSON file</span>
                <label
                  htmlFor="geojson-file"
                  className="flex cursor-pointer items-center justify-between gap-3 rounded border border-dashed border-ink-700 bg-ink-950 px-3 py-2 transition hover:border-accent-500"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <FileUp className="h-4 w-4 shrink-0 text-accent-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-ink-200">
                        {geoJsonData
                          ? `${geoJsonData.features.length} features loaded`
                          : 'Choose a .geojson or .json file'}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-500">
                        {geoJsonData
                          ? 'Ready to preview below'
                          : 'A FeatureCollection with one feature per place'}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300">
                    Browse
                  </span>
                  <input
                    id="geojson-file"
                    type="file"
                    accept=".geojson,.json,application/json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label htmlFor="quiz-title" className={labelClass}>
                  Title
                </label>
                <input
                  id="quiz-title"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. New South Wales: Local Government Areas"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="quiz-region" className={labelClass}>
                  Region
                </label>
                <input
                  id="quiz-region"
                  type="text"
                  value={countryOrRegion}
                  onChange={(event) => setCountryOrRegion(event.target.value)}
                  placeholder="e.g. Australia, United States, World"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="quiz-category" className={labelClass}>
                  Category
                </label>
                <select
                  id="quiz-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as QuizCategory)}
                  className={`${inputClass} cursor-pointer`}
                >
                  {CATEGORY_ORDER.map((option) => (
                    <option key={option} value={option}>
                      {categoryLabel(option)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="name-property" className={labelClass}>
                  Name property
                </label>
                <select
                  id="name-property"
                  value={selectedNameProp}
                  onChange={(event) => setSelectedNameProp(event.target.value)}
                  disabled={availableProps.length === 0}
                  className={`${inputClass} cursor-pointer`}
                >
                  {availableProps.length === 0 ? (
                    <option value="">Load a file first</option>
                  ) : (
                    availableProps.map((property) => (
                      <option key={property} value={property}>
                        {property}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label htmlFor="filter-property" className={labelClass}>
                  Filter property <span className="text-ink-500">(optional)</span>
                </label>
                <select
                  id="filter-property"
                  value={filterProp}
                  onChange={(event) => setFilterProp(event.target.value)}
                  disabled={availableProps.length === 0}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="">Use every feature</option>
                  {availableProps.map((property) => (
                    <option key={property} value={property}>
                      {property}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="filter-value" className={labelClass}>
                  Filter value <span className="text-ink-500">(optional)</span>
                </label>
                <input
                  id="filter-value"
                  type="text"
                  value={filterVal}
                  onChange={(event) => setFilterVal(event.target.value)}
                  disabled={!filterProp}
                  placeholder="e.g. Central"
                  className={inputClass}
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="quiz-tags" className={labelClass}>
                  Tags <span className="text-ink-500">(optional)</span>
                </label>
                <input
                  id="quiz-tags"
                  type="text"
                  value={tagsInput}
                  onChange={(event) => setTagsInput(event.target.value)}
                  placeholder="Comma separated, e.g. Australia, NSW, coast"
                  className={inputClass}
                />
                <p className="mt-1.5 text-xs text-ink-500">
                  Tags are searchable and help you group your own quizzes.
                </p>
              </div>
            </div>

            {samplePreviewNames.length > 0 ? (
              <div className="bg-ink-950 border border-ink-800 rounded p-2.5">
                <p className="mb-2 text-xs text-ink-500">
                  Previewing {samplePreviewNames.length} names
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {samplePreviewNames.map((name) => (
                    <span
                      key={name}
                      className="px-1.5 py-0.5 rounded bg-ink-900 border border-ink-800 text-[11px] text-ink-300"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-300">
                <input
                  type="checkbox"
                  checked={enrollOnCreate}
                  onChange={(event) => setEnrollOnCreate(event.target.checked)}
                  className="accent-accent-500"
                />
                Add to revision queue after creating
              </label>

              <button
                type="submit"
                disabled={saving || !geoJsonData}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-accent-600 hover:bg-accent-500 disabled:opacity-40 text-white font-bold transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {saving ? 'SAVING...' : 'CREATE QUIZ'}
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden bg-ink-900 border border-ink-800 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 border-b border-ink-800 pb-2">
            <div>
              <h2 className="text-xs font-bold uppercase text-ink-300">YOUR CUSTOM QUIZZES</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                Quizzes you have imported into this browser.
              </p>
            </div>
            <span className="text-xs text-ink-500">{customQuizzes.length}</span>
          </div>

          {customQuizzes.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-500">
              Nothing here yet. Your first imported quiz will appear in this list.
            </p>
          ) : (
            <ul>
              {customQuizzes.map((quiz) => (
                <li
                  key={quiz.id}
                  className="flex items-center justify-between gap-4 py-2.5 border-b border-ink-800/70 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-ink-200">
                      {cleanQuizTitle(quiz.title)}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {quiz.countryOrRegion} · {categoryLabel(quiz.category)} ·{' '}
                      {itemCountLabel(quiz)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDeleteCustomQuiz(quiz.id)}
                    aria-label={`Delete ${cleanQuizTitle(quiz.title)}`}
                    title="Delete quiz"
                    className="inline-flex items-center gap-1 px-2.5 py-1 shrink-0 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    DELETE
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-ink-900 border border-ink-800 rounded-xl p-5 space-y-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="max-w-xl">
              <h2 className="text-xs font-bold text-ink-300">BACKUP &amp; SYNC</h2>
              <p className="mt-1 text-xs leading-5 text-ink-500">
                Copy a sync code or export a JSON file to move your progress between
                devices. Importing replaces the data stored in this browser.
              </p>
              <p className="mt-2 text-xs text-ink-500">
                {attempts.length} practice {attempts.length === 1 ? 'run' : 'runs'} ·{' '}
                {enrolledIds.length} queued · {customQuizzes.length} custom
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopySyncCode}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent-600 hover:bg-accent-500 text-white font-bold cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                COPY SYNC CODE
              </button>

              <button
                type="button"
                onClick={handleExportProgress}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 border border-ink-700 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-accent-400" />
                EXPORT JSON
              </button>

              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 border border-ink-700 cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-emerald-400" />
                IMPORT JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportBackupFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-3 border-t border-ink-800">
            <label htmlFor="sync-code" className="sr-only">
              Sync code
            </label>
            <input
              id="sync-code"
              type="text"
              value={syncCodeInput}
              onChange={(event) => setSyncCodeInput(event.target.value)}
              placeholder="Paste a sync code from another device"
              className={`${inputClass} flex-1`}
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
        </section>
      </div>
    </div>
  );
}
