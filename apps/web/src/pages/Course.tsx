import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  FileText,
  MessageSquare,
  NotebookPen,
  Sparkles,
  Trophy,
  Upload,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { MarkdownContent } from '../components/MarkdownContent';
import { Empty, ErrorBox, Loading } from '../components/ui';
import { api } from '../lib/api';
import { AiCooldownNotice, formatAiCooldown, useAiCooldown } from '../app/ai-cooldown';
import { useTranslation } from '../i18n';

type Course = {
  id: string;
  name: string;
  code?: string;
  description?: string;
  _count: Record<string, number>;
};
type Source = {
  id: string;
  displayName: string;
  processingStatus: string;
  pageCount?: number;
  sizeBytes: number;
  processingErrorMessage?: string;
};
type AIStatus = {
  mode: 'AI_TUTOR' | 'DEMO';
  provider: string;
  label: 'AI Tutor' | 'Demo mode';
  message: string;
};
function useAIStatus() {
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<AIStatus>('/ai/status'),
  });
}
const tabs = [
  ['', BookOpen, 'overview'],
  ['sources', FileText, 'sources'],
  ['chat', MessageSquare, 'chat'],
  ['explain', Sparkles, 'explain'],
  ['notes', NotebookPen, 'notes'],
  ['summaries', Sparkles, 'summaries'],
  ['flashcards', BookOpen, 'flashcards'],
  ['quizzes', Trophy, 'quizzes'],
  ['progress', Trophy, 'progress'],
] as const;

export function CoursePage({ tab = '' }: { tab?: string }) {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['course', id],
    queryFn: () => api.get<Course>(`/courses/${id}`),
  });
  const aiStatus = useAIStatus();
  if (query.isLoading) return <Loading />;
  if (!query.data) return <Empty title={t('course.notFound')} />;
  return (
    <div className="space-y-7">
      <header>
        <p className="text-sm font-semibold text-brand-600">
          {query.data.code || t('course.workspace')}
        </p>
        <h1 className="text-3xl font-bold">{query.data.name}</h1>
        <p className="text-slate-500">{query.data.description || t('course.description')}</p>
        <div
          className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${aiStatus.data?.mode === 'AI_TUTOR' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}
          title={
            aiStatus.data
              ? t(
                  aiStatus.data.mode === 'AI_TUTOR'
                    ? 'course.aiTutorMessage'
                    : 'course.demoMessage',
                )
              : undefined
          }
        >
          {aiStatus.data
            ? t(aiStatus.data.mode === 'AI_TUTOR' ? 'course.aiTutor' : 'course.demoMode')
            : t('course.checkingAi')}
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {tabs.map(([path, Icon, label]) => (
          <NavLink
            end={path === ''}
            key={path}
            to={`/app/courses/${id}${path ? `/${path}` : ''}`}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold ${isActive ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500'}`
            }
          >
            <Icon size={16} />
            {t(`course.tabs.${label}`)}
          </NavLink>
        ))}
      </nav>
      <AiCooldownNotice />
      {tab === '' && <Overview course={query.data} />}
      {tab === 'sources' && <Sources courseId={id} />}
      {tab === 'chat' && <Chat courseId={id} />}
      {tab === 'explain' && <Explain courseId={id} />}
      {tab === 'notes' && <Notes courseId={id} />}
      {tab === 'summaries' && <Summaries courseId={id} />}
      {tab === 'flashcards' && <Flashcards courseId={id} />}
      {tab === 'quizzes' && <Quizzes courseId={id} />}
      {tab === 'progress' && <Progress courseId={id} />}
    </div>
  );
}

function Overview({ course }: { course: Course }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[
        [t('course.overview.sources'), course._count.sources],
        [t('course.overview.notes'), course._count.notes],
        [t('course.overview.quizzes'), course._count.quizzes],
        [t('course.overview.flashcards'), course._count.flashcards],
      ].map(([label, value]) => (
        <div className="card" key={label}>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-bold">{value}</p>
        </div>
      ))}
    </div>
  );
}

function Sources({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [uploading, setUploading] = useState(false);
  const query = useQuery({
    queryKey: ['sources', courseId],
    queryFn: () => api.get<Source[]>(`/courses/${courseId}/sources`),
    refetchInterval: 3000,
  });
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const input = formElement.elements.namedItem('file') as HTMLInputElement;
    if (!input.files?.[0]) return;
    const body = new FormData();
    body.append('file', input.files[0]);
    setUploading(true);
    try {
      await api.post(`/courses/${courseId}/sources`, body);
      await qc.invalidateQueries({ queryKey: ['sources', courseId] });
      formElement.reset();
    } catch (reason) {
      setError(reason);
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="space-y-5">
      <form className="card flex flex-wrap items-end gap-3" onSubmit={upload}>
        <label className="min-w-56 flex-1">
          <span className="label">{t('course.upload.label')}</span>
          <input
            className="field"
            name="file"
            type="file"
            accept=".pdf,.docx,.pptx,.txt,.md,.markdown"
            required
          />
        </label>
        <button className="btn-primary" disabled={uploading}>
          <Upload size={17} />
          {uploading ? t('course.upload.uploading') : t('course.upload.button')}
        </button>
      </form>
      <ErrorBox error={error} />
      {query.data?.length ? (
        <div className="space-y-3">
          {query.data.map((source) => (
            <div className="card flex items-center gap-4" key={source.id}>
              <FileText className="text-brand-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{source.displayName}</p>
                <p className="text-xs text-slate-500">
                  {(source.sizeBytes / 1_048_576).toFixed(1)} MB{' '}
                  {source.pageCount ? `· ${source.pageCount} pages` : ''}
                </p>
              </div>
              <div className="text-end">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold dark:bg-slate-800">
                  {source.processingStatus === 'QUEUED'
                    ? t('course.upload.indexing')
                    : source.processingStatus === 'PROCESSING'
                      ? t('course.upload.processing')
                      : source.processingStatus === 'READY'
                        ? t('course.upload.ready')
                        : t('course.upload.failed')}
                </span>
                {source.processingStatus === 'FAILED' && (
                  <div className="mt-2">
                    <button
                      className="text-xs font-semibold text-brand-600"
                      onClick={() =>
                        void api
                          .post(`/sources/${source.id}/reprocess`)
                          .then(() => qc.invalidateQueries({ queryKey: ['sources', courseId] }))
                      }
                    >
                      {t('common.retry')}
                    </button>
                  </div>
                )}
              </div>
              <button
                className="text-sm text-red-600"
                onClick={() =>
                  void api
                    .delete(`/sources/${source.id}`)
                    .then(() => qc.invalidateQueries({ queryKey: ['sources', courseId] }))
                }
              >
                {t('common.delete')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty title={t('course.upload.emptyTitle')}>{t('course.upload.emptyBody')}</Empty>
      )}
    </div>
  );
}

type Conversation = { id: string; title: string };
type Message = {
  id: string;
  role: string;
  content: string;
  citations?: {
    id: string;
    citationOrder: number;
    pageStart?: number;
    quotedExcerpt?: string;
    source: { displayName: string };
    documentChunk?: {
      metadata?: {
        slideNumber?: number;
        sectionTitle?: string;
        sectionHeading?: string;
        headingConfidence?: string;
        chunkIndex?: number;
        headingPath?: string[];
      };
    };
  }[];
};
type StudyAction =
  'EXPLAIN' | 'SUMMARIZE' | 'CREATE_EXAM_QUESTIONS' | 'STUDY_FIRST' | 'SIMPLIFY' | 'EXAM_PREP';
const studyActions: { action: StudyAction; labelKey: string; prompt: string; mode: string }[] = [
  { action: 'EXPLAIN', labelKey: 'explain', prompt: 'Explain this lecture', mode: 'EXPLAIN' },
  {
    action: 'SUMMARIZE',
    labelKey: 'summarize',
    prompt: 'Summarize this lecture',
    mode: 'SUMMARIZE',
  },
  {
    action: 'CREATE_EXAM_QUESTIONS',
    labelKey: 'examQuestions',
    prompt: 'Create exam questions from this lecture',
    mode: 'EXAM_PREP',
  },
  {
    action: 'STUDY_FIRST',
    labelKey: 'studyFirst',
    prompt: 'What should I study first?',
    mode: 'STUDY',
  },
  {
    action: 'SIMPLIFY',
    labelKey: 'simplify',
    prompt: 'Explain this lecture in simple words',
    mode: 'SIMPLIFY',
  },
  {
    action: 'EXAM_PREP',
    labelKey: 'examPrep',
    prompt: 'Prepare me for an exam on this lecture',
    mode: 'EXAM_PREP',
  },
];
function Chat({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [active, setActive] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState('EXPLAIN');
  const [action, setAction] = useState<StudyAction>('EXPLAIN');
  const [busy, setBusy] = useState(false);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const cooldown = useAiCooldown();
  const [lastRequest, setLastRequest] = useState<{
    content: string;
    mode: string;
    action: StudyAction;
  }>();
  const conversations = useQuery({
    queryKey: ['conversations', courseId],
    queryFn: () => api.get<Conversation[]>(`/courses/${courseId}/conversations`),
  });
  const aiStatus = useAIStatus();
  const messages = useQuery({
    queryKey: ['messages', active],
    queryFn: () => api.get<Message[]>(`/conversations/${active}/messages`),
    enabled: Boolean(active),
  });
  const sources = useQuery({
    queryKey: ['sources', courseId],
    queryFn: () => api.get<Source[]>(`/courses/${courseId}/sources`),
  });
  const readySources = sources.data?.filter((source) => source.processingStatus === 'READY') ?? [];
  async function sendRequest(content: string, selectedMode: string, selectedAction: StudyAction) {
    if (!content.trim() || busy || cooldown.coolingDown || !readySources.length) return;
    setBusy(true);
    setError(undefined);
    setLastRequest({ content, mode: selectedMode, action: selectedAction });
    try {
      let id = active;
      if (!id) {
        const created = await api.post<Conversation>(`/courses/${courseId}/conversations`, {
          title: t('course.chat.newConversation'),
          mode: 'EXPLAIN',
        });
        id = created.id;
        setActive(id);
      }
      await api.post(`/conversations/${id}/messages`, {
        content: content.trim(),
        mode: selectedMode,
        action: selectedAction,
        ...(sourceIds.length ? { sourceIds } : {}),
      });
      setDraft('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['messages', id] }),
        qc.invalidateQueries({ queryKey: ['conversations', courseId] }),
      ]);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendRequest(draft, mode, action);
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
      <aside className="card h-fit">
        <button className="btn-primary mb-4 w-full" onClick={() => setActive(undefined)}>
          {t('course.chat.new')}
        </button>
        {conversations.data?.map((item) => (
          <button
            className={`block w-full truncate rounded-lg p-2 text-start text-sm ${active === item.id ? 'bg-brand-50 text-brand-700' : ''}`}
            key={item.id}
            onClick={() => setActive(item.id)}
          >
            {item.title}
          </button>
        ))}
      </aside>
      <section className="card flex min-h-[560px] flex-col">
        <div
          className={`mb-4 rounded-xl px-3 py-2 text-sm font-medium ${aiStatus.data?.mode === 'AI_TUTOR' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}
        >
          {aiStatus.data
            ? t(aiStatus.data.mode === 'AI_TUTOR' ? 'course.aiTutorMessage' : 'course.demoMessage')
            : t('course.checkingTutor')}
        </div>
        <div className="mb-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            {t('course.chat.sourceScope')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={`rounded-full px-3 py-1 text-xs font-semibold ${sourceIds.length ? 'bg-slate-100 dark:bg-slate-800' : 'bg-brand-600 text-white'}`}
              onClick={() => setSourceIds([])}
            >
              {t('course.chat.allSources')}
            </button>
            {readySources.map((source) => (
              <button
                className={`rounded-full px-3 py-1 text-xs font-semibold ${sourceIds.includes(source.id) ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}
                key={source.id}
                onClick={() =>
                  setSourceIds((current) =>
                    current.includes(source.id)
                      ? current.filter((id) => id !== source.id)
                      : [...current, source.id],
                  )
                }
              >
                {source.displayName}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 space-y-5">
          {messages.data?.map((message) => (
            <article
              className={
                message.role === 'USER'
                  ? 'ms-auto max-w-2xl rounded-2xl bg-brand-600 p-4 text-white'
                  : 'max-w-3xl'
              }
              key={message.id}
            >
              <MarkdownContent content={message.content} />
              {message.citations?.length ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {t('course.chat.sources')}
                  </p>
                  {message.citations.map((citation) => (
                    <details
                      className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      key={citation.id}
                    >
                      <summary className="cursor-pointer font-semibold">
                        [S{citation.citationOrder}] {citation.source.displayName}
                        {citation.pageStart
                          ? ` · ${t('course.chat.page', { page: citation.pageStart })}`
                          : ''}
                        {citation.documentChunk?.metadata?.slideNumber
                          ? ` · ${t('course.chat.slide', { slide: citation.documentChunk.metadata.slideNumber })}`
                          : ''}
                        {citation.documentChunk?.metadata?.headingConfidence !== 'low' &&
                        (citation.documentChunk?.metadata?.sectionTitle ||
                          citation.documentChunk?.metadata?.sectionHeading)
                          ? ` · ${citation.documentChunk.metadata.headingPath?.join(' › ') || citation.documentChunk.metadata.sectionTitle || citation.documentChunk.metadata.sectionHeading}`
                          : citation.documentChunk?.metadata?.chunkIndex !== undefined
                            ? ` · ${t('course.chat.chunk', { chunk: citation.documentChunk.metadata.chunkIndex + 1 })}`
                            : ''}
                      </summary>
                      {citation.quotedExcerpt && (
                        <p className="mt-2" dir="ltr">
                          {citation.quotedExcerpt}
                        </p>
                      )}
                    </details>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {!messages.data?.length && (
            <Empty title={t('course.chat.emptyTitle')}>
              {readySources.length ? t('course.chat.emptyReady') : t('course.chat.emptyNoSource')}
            </Empty>
          )}
          {busy && (
            <p className="animate-pulse text-sm font-semibold text-brand-600">
              {t('course.chat.studying')}
            </p>
          )}
        </div>
        <form className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800" onSubmit={send}>
          <ErrorBox error={error} />
          {Boolean(error) && lastRequest && (
            <button
              className="mt-2 text-sm font-semibold text-brand-600"
              disabled={cooldown.coolingDown}
              type="button"
              onClick={() =>
                void sendRequest(lastRequest.content, lastRequest.mode, lastRequest.action)
              }
            >
              {t('course.chat.retry')}
            </button>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {studyActions.map((item) => (
              <button
                className="rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-slate-800"
                disabled={cooldown.coolingDown}
                key={item.action}
                type="button"
                onClick={() => {
                  setAction(item.action);
                  setMode(item.mode);
                  setDraft(item.prompt);
                }}
              >
                {t(`course.actions.${item.labelKey}`)}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <select
              className="field max-w-40"
              value={action}
              onChange={(event) => {
                const selected = studyActions.find((item) => item.action === event.target.value)!;
                setAction(selected.action);
                setMode(selected.mode);
              }}
            >
              {studyActions.map((item) => (
                <option key={item.action} value={item.action}>
                  {t(`course.actions.${item.labelKey}`)}
                </option>
              ))}
            </select>
            <textarea
              className="field min-h-12 resize-y"
              placeholder={t('course.chat.placeholder')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              required
            />
            <button
              className="btn-primary"
              disabled={busy || cooldown.coolingDown || !readySources.length || !draft.trim()}
            >
              {busy
                ? t('course.chat.thinking')
                : cooldown.coolingDown
                  ? t('common.wait', { time: formatAiCooldown(cooldown.secondsRemaining) })
                  : t('course.chat.send')}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">{t('course.chat.shortcut')}</p>
        </form>
      </section>
    </div>
  );
}

function Explain({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('STANDARD');
  const [result, setResult] = useState<Summary>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const aiStatus = useAIStatus();
  const cooldown = useAiCooldown();
  async function generate() {
    setBusy(true);
    setError(undefined);
    try {
      setResult(
        await api.post<Summary>(`/courses/${courseId}/explanations`, { sourceIds: [], mode }),
      );
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <div
        className={`rounded-xl px-3 py-2 text-sm font-medium ${aiStatus.data?.mode === 'AI_TUTOR' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}
      >
        {aiStatus.data
          ? t(aiStatus.data.mode === 'AI_TUTOR' ? 'course.aiTutorMessage' : 'course.demoMessage')
          : t('course.checkingTutor')}
      </div>
      <div className="card flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('course.explain.title')}</h2>
          <p className="text-sm text-slate-500">{t('course.explain.description')}</p>
        </div>
        <div className="flex gap-2">
          <select className="field" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="SIMPLE">{t('course.explain.simple')}</option>
            <option value="STANDARD">{t('course.explain.standard')}</option>
            <option value="DETAILED">{t('course.explain.detailed')}</option>
            <option value="EXAM_PREPARATION">{t('course.explain.examPreparation')}</option>
          </select>
          <button
            className="btn-primary"
            disabled={busy || cooldown.coolingDown}
            onClick={() => void generate()}
          >
            {busy
              ? t('common.generating')
              : cooldown.coolingDown
                ? t('common.wait', { time: formatAiCooldown(cooldown.secondsRemaining) })
                : t('course.explain.button')}
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      {result ? (
        <article className="card">
          <h3 className="text-xl font-bold" dir="ltr">
            {result.title}
          </h3>
          <div className="mt-4">
            <MarkdownContent content={result.content} />
          </div>
          <SourcesAfterAnswer sources={result.sources} />
        </article>
      ) : (
        <Empty title={t('course.explain.empty')} />
      )}
    </div>
  );
}

type Note = { id: string; title: string; content: string };
function Notes({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['notes', courseId],
    queryFn: () => api.get<Note[]>(`/courses/${courseId}/notes`),
  });
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await api.post(`/courses/${courseId}/notes`, {
      title: form.get('title'),
      content: form.get('content'),
    });
    formElement.reset();
    await qc.invalidateQueries({ queryKey: ['notes', courseId] });
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <form className="card h-fit space-y-3" onSubmit={create}>
        <h2 className="font-bold">{t('course.notes.new')}</h2>
        <input className="field" name="title" placeholder={t('course.notes.title')} required />
        <textarea
          className="field min-h-40"
          name="content"
          placeholder={t('course.notes.markdown')}
        />
        <button className="btn-primary">{t('course.notes.save')}</button>
      </form>
      <div className="space-y-3">
        {query.data?.length ? (
          query.data.map((note) => (
            <article className="card" key={note.id}>
              <h3 className="font-bold">{note.title}</h3>
              <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                <MarkdownContent content={note.content} />
              </div>
            </article>
          ))
        ) : (
          <Empty title={t('course.notes.empty')} />
        )}
      </div>
    </div>
  );
}

type SourceReference = {
  source: { id: string; displayName: string; pageCount?: number };
};
type Summary = {
  id: string;
  title: string;
  content: string;
  type: string;
  sources?: SourceReference[];
};
function SourcesAfterAnswer({ sources }: { sources: SourceReference[] | undefined }) {
  const { t } = useTranslation();
  if (!sources?.length) return null;
  return (
    <section className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {t('common.sources')}
      </p>
      <ul className="mt-2 space-y-2">
        {sources.map(({ source }, index) => (
          <li
            className="rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800"
            key={source.id}
          >
            [D{index + 1}] {source.displayName}
            {source.pageCount ? ` · ${t('common.pages', { count: source.pageCount })}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}
function Summaries({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [type, setType] = useState('KEY_POINTS');
  const [busy, setBusy] = useState(false);
  const cooldown = useAiCooldown();
  const query = useQuery({
    queryKey: ['summaries', courseId],
    queryFn: () => api.get<Summary[]>(`/courses/${courseId}/summaries`),
  });
  async function create() {
    setBusy(true);
    try {
      await api.post(`/courses/${courseId}/summaries`, { sourceIds: [], type });
      await qc.invalidateQueries({ queryKey: ['summaries', courseId] });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('course.summaries.title')}</h2>
          <p className="text-sm text-slate-500">{t('course.summaries.description')}</p>
        </div>
        <div className="flex gap-2">
          <select className="field" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="KEY_POINTS">{t('course.summaries.keyPoints')}</option>
            <option value="SHORT">{t('course.summaries.short')}</option>
            <option value="DETAILED">{t('course.summaries.detailed')}</option>
            <option value="EXAM_REVISION">{t('course.summaries.examRevision')}</option>
          </select>
          <button
            className="btn-primary"
            disabled={busy || cooldown.coolingDown}
            onClick={() => void create()}
          >
            <Sparkles size={16} />
            {busy
              ? t('common.generating')
              : cooldown.coolingDown
                ? t('common.wait', { time: formatAiCooldown(cooldown.secondsRemaining) })
                : t('common.generate')}
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      {query.data?.length ? (
        query.data.map((summary) => (
          <article className="card" key={summary.id}>
            <p className="text-xs font-bold text-brand-600">
              {t(
                `course.summaries.${summary.type === 'KEY_POINTS' ? 'keyPoints' : summary.type === 'EXAM_REVISION' ? 'examRevision' : summary.type.toLowerCase()}`,
              )}
            </p>
            <h3 className="mt-1 text-lg font-bold" dir="ltr">
              {summary.title}
            </h3>
            <div className="mt-4 text-sm">
              <MarkdownContent content={summary.content} />
            </div>
            <SourcesAfterAnswer sources={summary.sources} />
          </article>
        ))
      ) : (
        <Empty title={t('course.summaries.empty')} />
      )}
    </div>
  );
}

type CardSet = {
  id: string;
  title: string;
  cards: { id: string; front: string; back: string; topic: string }[];
};
function Flashcards({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [flipped, setFlipped] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [count, setCount] = useState(20);
  const [busy, setBusy] = useState(false);
  const aiStatus = useAIStatus();
  const cooldown = useAiCooldown();
  const query = useQuery({
    queryKey: ['cards', courseId],
    queryFn: () => api.get<CardSet[]>(`/courses/${courseId}/flashcard-sets`),
  });
  async function generate() {
    setBusy(true);
    try {
      await api.post(`/courses/${courseId}/flashcard-sets`, {
        sourceIds: [],
        title: 'Study cards',
        count,
      });
      await qc.invalidateQueries({ queryKey: ['cards', courseId] });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-xl font-bold">{t('course.flashcards.title')}</h2>
        <div className="flex gap-2">
          <input
            aria-label={t('course.flashcards.count')}
            className="field w-24"
            type="number"
            min="1"
            max="50"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
          <button
            className="btn-primary"
            disabled={busy || cooldown.coolingDown || aiStatus.data?.mode === 'DEMO'}
            title={
              aiStatus.data?.mode === 'DEMO' ? t('course.flashcards.requiresTutor') : undefined
            }
            onClick={() => void generate()}
          >
            {busy
              ? t('common.generating')
              : cooldown.coolingDown
                ? t('common.wait', { time: formatAiCooldown(cooldown.secondsRemaining) })
                : t('course.flashcards.generate')}
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      {query.data?.flatMap((set) => set.cards).length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {query.data
            ?.flatMap((set) => set.cards)
            .map((card) => (
              <button
                className="card min-h-48 text-start"
                key={card.id}
                onClick={() => setFlipped(flipped === card.id ? undefined : card.id)}
              >
                <p className="text-xs font-bold text-brand-600" dir="ltr">
                  {card.topic}
                </p>
                <p className="mt-5 text-lg font-semibold" dir="ltr">
                  {flipped === card.id ? card.back : card.front}
                </p>
                <small className="mt-5 block text-slate-400">{t('course.flashcards.flip')}</small>
              </button>
            ))}
        </div>
      ) : (
        <Empty title={t('course.flashcards.empty')} />
      )}
    </div>
  );
}

type Quiz = {
  id: string;
  title: string;
  difficulty: string;
  _count: { questions: number; attempts: number };
};
function Quizzes({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  const [questionCount, setQuestionCount] = useState(15);
  const [questionType, setQuestionType] = useState('MULTIPLE_CHOICE');
  const [difficulty, setDifficulty] = useState('MIXED');
  const [busy, setBusy] = useState(false);
  const aiStatus = useAIStatus();
  const cooldown = useAiCooldown();
  const query = useQuery({
    queryKey: ['quizzes', courseId],
    queryFn: () => api.get<Quiz[]>(`/courses/${courseId}/quizzes`),
  });
  async function generate() {
    setBusy(true);
    try {
      await api.post(`/courses/${courseId}/quizzes`, {
        sourceIds: [],
        title: 'Practice quiz',
        difficulty,
        questionCount,
        questionType,
      });
      await qc.invalidateQueries({ queryKey: ['quizzes', courseId] });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  async function start(id: string) {
    try {
      const attempt = await api.post<{ id: string }>(`/quizzes/${id}/attempts`);
      navigate(`/app/quiz-attempts/${attempt.id}?quiz=${id}`);
    } catch (reason) {
      setError(reason);
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-xl font-bold">{t('course.quizzes.title')}</h2>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label={t('course.quizzes.count')}
            className="field w-24"
            type="number"
            min="1"
            max="30"
            value={questionCount}
            onChange={(event) => setQuestionCount(Number(event.target.value))}
          />
          <select
            className="field w-auto"
            value={questionType}
            onChange={(event) => setQuestionType(event.target.value)}
          >
            <option value="MULTIPLE_CHOICE">{t('course.quizzes.multipleChoice')}</option>
            <option value="TRUE_FALSE">{t('course.quizzes.trueFalse')}</option>
            <option value="SHORT_ANSWER">{t('course.quizzes.shortAnswer')}</option>
            <option value="ESSAY">{t('course.quizzes.essay')}</option>
            <option value="PROBLEM_SOLVING">{t('course.quizzes.problemSolving')}</option>
          </select>
          <select
            className="field w-auto"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          >
            <option value="EASY">{t('course.quizzes.easy')}</option>
            <option value="MEDIUM">{t('course.quizzes.medium')}</option>
            <option value="HARD">{t('course.quizzes.hard')}</option>
            <option value="MIXED">{t('course.quizzes.mixed')}</option>
          </select>
          <button
            className="btn-primary"
            disabled={busy || cooldown.coolingDown || aiStatus.data?.mode === 'DEMO'}
            title={aiStatus.data?.mode === 'DEMO' ? t('course.quizzes.requiresTutor') : undefined}
            onClick={() => void generate()}
          >
            {busy
              ? t('common.generating')
              : cooldown.coolingDown
                ? t('common.wait', { time: formatAiCooldown(cooldown.secondsRemaining) })
                : t('course.quizzes.generate')}
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      {query.data?.length ? (
        query.data.map((quiz) => (
          <div className="card flex items-center justify-between" key={quiz.id}>
            <div>
              <h3 className="font-bold" dir="ltr">
                {quiz.title}
              </h3>
              <p className="text-sm text-slate-500">
                {t('common.questions', { count: quiz._count.questions })} ·{' '}
                {t(`course.quizzes.${quiz.difficulty.toLowerCase()}`)} ·{' '}
                {t('common.attempts', { count: quiz._count.attempts })}
              </p>
            </div>
            <button className="btn-secondary" onClick={() => void start(quiz.id)}>
              {t('course.quizzes.start')}
            </button>
          </div>
        ))
      ) : (
        <Empty title={t('course.quizzes.empty')} />
      )}
    </div>
  );
}

type ProgressData = {
  documents: number;
  quizzesCompleted: number;
  averageQuizScore: number;
  flashcardsReviewed: number;
  weakTopics: { id: string; topic: string; masteryPercent: number }[];
  disclaimer: string;
};
function Progress({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['progress', courseId],
    queryFn: () => api.get<ProgressData>(`/courses/${courseId}/progress`),
  });
  if (query.isLoading) return <Loading />;
  const data = query.data;
  return (
    <div className="space-y-5">
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
        {t('course.progress.disclaimer')}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [t('course.progress.documents'), data?.documents ?? 0],
          [t('course.progress.completed'), data?.quizzesCompleted ?? 0],
          [t('course.progress.average'), `${Math.round(data?.averageQuizScore ?? 0)}%`],
        ].map(([label, value]) => (
          <div className="card" key={label}>
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      <section className="card">
        <h2 className="mb-4 text-lg font-bold">{t('course.progress.mastery')}</h2>
        {data?.weakTopics.length ? (
          data.weakTopics.map((topic) => (
            <div className="mb-4" key={topic.id}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{topic.topic}</span>
                <b>{Math.round(topic.masteryPercent)}%</b>
              </div>
              <div className="h-2 rounded bg-slate-100">
                <div
                  className="h-2 rounded bg-brand-600"
                  style={{ width: `${topic.masteryPercent}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">{t('course.progress.empty')}</p>
        )}
      </section>
    </div>
  );
}
