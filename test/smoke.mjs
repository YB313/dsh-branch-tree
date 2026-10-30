/**
 * Smoke test for the branch-tree client module (v3): loads client.js inside a
 * fake browser shell, expands the rendered element tree, and asserts that the
 * left column shows a master session as a folder with its branches indented
 * underneath.
 *
 * Run: node test/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, '..');

const log = [];
function ok(cond, label) {
  if (!cond) {
    console.error('FAIL: ' + label);
    process.exitCode = 1;
  } else {
    log.push('ok: ' + label);
  }
}

// ------------------------------------------------------------ fake browser
let captured;
const storage = new Map();
globalThis.window = {
  navigator: { language: 'zh-CN' },
  __ModuleLoader__: {
    load(def) {
      captured = def;
    },
  },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  },
};
try {
  Object.defineProperty(globalThis, 'navigator', { value: globalThis.window.navigator, configurable: true });
} catch (e) {
  // Node exposes navigator as a getter; the dictionary choice is cosmetic here.
}
globalThis.document = {
  head: { appendChild() {} },
  createElement: () => ({ id: '', textContent: '', remove() {} }),
};

class Component {
  constructor(props) {
    this.props = props || {};
    this.state = {};
  }
  setState(next) {
    Object.assign(this.state, typeof next === 'function' ? next(this.state) : next);
  }
}
Component.prototype.isReactComponent = {};

const stateWrites = [];
let hookSeed = null;
let hookIndex = 0;
const ReactStub = {
  Component,
  createElement(type, props, ...children) {
    return { type, props: Object.assign({}, props || {}, { children }) };
  },
  useState(init) {
    const index = hookIndex++;
    const initial = typeof init === 'function' ? init() : init;
    const value = hookSeed && Object.prototype.hasOwnProperty.call(hookSeed, index) ? hookSeed[index] : initial;
    return [value, (next) => stateWrites.push({ index, next })];
  },
  useEffect() {},
  useCallback(fn) {
    return fn;
  },
  useMemo(fn) {
    return fn();
  },
  useRef(init) {
    return { current: init === undefined ? null : init };
  },
};
const PrimitiveStub = {
  IconFolderOpenRegular: function IconFolderOpenRegular() {},
  IconFolderCloseRegular: function IconFolderCloseRegular() {},
};
function req(name) {
  if (name === 'react') return ReactStub;
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return PrimitiveStub;
  throw new Error('unexpected module: ' + name);
}

const code = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8');
new Function(code)();
ok(!!captured, 'module loader captured the factory');
ok(captured.id === 'dsh-branch-tree', 'factory id matches package name');

const plugin = captured.factory(req);
const debug = plugin.debug;
ok(!!debug, 'debug surface exposed');
const runningStatuses = debug.reconcileTaskStatuses(
  { 'session-task-a1': 'running', 'session-task-b1': 'unread', 'session-stale-a1': 'invalid' },
  new Map([
    ['session-task-a1', { running: false }],
    ['session-task-b1', { running: true }],
    ['session-task-c1', { running: false }],
  ])
);
ok(runningStatuses['session-task-a1'] === 'unread', 'running-to-idle transition marks only that task unread');
ok(runningStatuses['session-task-b1'] === 'running', 'concurrent task remains independently marked running');
ok(!Object.prototype.hasOwnProperty.call(runningStatuses, 'session-task-c1'), 'idle task without prior work has no indicator');
ok(!Object.prototype.hasOwnProperty.call(runningStatuses, 'session-stale-a1'), 'invalid persisted status values are discarded');
const acknowledgedStatuses = debug.acknowledgeTaskStatus(runningStatuses, 'session-task-a1');
ok(!Object.prototype.hasOwnProperty.call(acknowledgedStatuses, 'session-task-a1'), 'opening a completed task clears its unread indicator');
ok(acknowledgedStatuses['session-task-b1'] === 'running', 'acknowledging one task preserves other tasks');
const statusKey = 'dsh.branch-tree.task-status.v1';
const openedId = 'session-task-open-success';
const parallelId = 'session-task-open-parallel';
window.localStorage.setItem(statusKey, JSON.stringify({ [openedId]: 'unread', [parallelId]: 'running' }));
const openCalls = [];
const openCallbacks = [];
const openCtx = { get: (name) => name === 'uiWorkspace' ? { openSession: async (id) => { openCalls.push(id); } } : undefined };
const didOpen = await debug.openSessionSafe(openCtx, openedId, (id) => openCallbacks.push(id));
const afterOpen = JSON.parse(window.localStorage.getItem(statusKey));
ok(didOpen && openCalls.length === 1 && openCalls[0] === openedId, 'successful session open resolves true');
ok(openCallbacks.length === 1 && openCallbacks[0] === openedId, 'successful session open invokes acknowledgement callback once');
ok(!Object.prototype.hasOwnProperty.call(afterOpen, openedId) && afterOpen[parallelId] === 'running', 'successful open clears only that session persisted status');
const failedId = 'session-task-open-failure';
window.localStorage.setItem(statusKey, JSON.stringify({ ...afterOpen, [failedId]: 'unread' }));
const failedCalls = [];
const failCtx = { get: () => ({ openSession: async (arg) => { failedCalls.push(arg); throw new Error('open failed'); } }) };
const failedOpen = await debug.openSessionSafe(failCtx, failedId, (id) => openCallbacks.push(id));
const afterFailure = JSON.parse(window.localStorage.getItem(statusKey));
ok(!failedOpen && failedCalls.length === 2, 'failed primary and fallback session opens resolve false');
ok(afterFailure[failedId] === 'unread' && openCallbacks.length === 1, 'failed open preserves unread status and skips acknowledgement callback');
window.localStorage.removeItem(statusKey);
ok(debug.taskStatusesEqual({ 'session-task-a1': 'unread' }, { 'session-task-a1': 'unread' }), 'status equality recognizes unchanged state');
ok(plugin.inject.length === 1 && plugin.inject[0] === 'slots', 'plugin injects slots');
const clientInject = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).dsh.client.inject;
ok(clientInject.includes('@deepseek-ai/dsh-client-ui-sidebar'), 'client manifest injects the sidebar slot provider');
ok(clientInject.includes('@deepseek-ai/dsh-client-ui-primitives'), 'client manifest injects Harness native UI primitives');
ok(clientInject.includes('@deepseek-ai/dsh-api-session-controller'), 'client manifest injects the session prompt/wait API');
ok(clientInject.includes('@deepseek-ai/dsh-api-workspace-files'), 'client manifest injects the workspace-files stat API');

const MERGE_SOURCE_ID = 'merge-source';
const MERGE_TARGET_ID = 'merge-target';
const mergeDate = new Date(2026, 9, 28, 12, 0, 0);
ok(debug.localVersionDate(mergeDate) === '261028', 'merge filenames use the local YYMMDD date');
ok(
  debug.mergeOutputPath('/x/task', 'source', 'target', mergeDate, 0) === '/x/task/merge_source_target_261028ver.md',
  'merge output names are unique, versioned Markdown files'
);
const branchPathStore = {
  masters: [{ id: MERGE_SOURCE_ID, title: 'Master' }],
  branches: [{ branchId: MERGE_TARGET_ID, parentId: MERGE_SOURCE_ID, masterId: MERGE_SOURCE_ID, dir: 'task/branch' }],
};
ok(
  debug.markdownDirFor(branchPathStore, MERGE_TARGET_ID, '/x') === '/x/task/branch',
  'merge reads a branch from its own bound Markdown directory'
);

const mergeRequests = [];
let mergeStatCount = 0;
const mergeCtx = {
  remote: {
    session: {
      prompt: async (request) => { mergeRequests.push(request); return { accepted: true }; },
      wait: async () => ({ reason: 'idle' }),
    },
    workspaceFiles: {
      stat: async () => {
        mergeStatCount += 1;
        if (mergeStatCount === 1) {
          const notFound = new Error('missing output file');
          notFound.code = 'workspace-file/not-found';
          throw notFound;
        }
        return { size: 64 };
      },
    },
  },
};
const mergeResult = await debug.mergeMarkdownWithModel(mergeCtx, {
  sourceId: MERGE_SOURCE_ID,
  sourceTitle: 'Source task',
  sourceDir: '/x/source',
  targetId: MERGE_TARGET_ID,
  targetTitle: 'Target task',
  targetDir: '/x/target',
  mode: 'branch',
  outputPath: '/x/source/merge_Source_Target_261028ver.md',
});
ok(mergeResult.path === '/x/source/merge_Source_Target_261028ver.md' && mergeResult.size === 64, 'merge verifies a non-empty file after model completion');
ok(mergeRequests.length === 1 && mergeRequests[0].sessionId === MERGE_SOURCE_ID && mergeRequests[0].mode === 'queue', 'merge prompt is queued in the dragged/source session');
ok(
  mergeRequests[0].content[0].text.includes('/x/source') &&
    mergeRequests[0].content[0].text.includes('/x/target') &&
    mergeRequests[0].content[0].text.includes('become a child branch'),
  'branch-mode prompt includes both Markdown directories and branch intent'
);

let overwritePromptCount = 0;
let existingMergeRefused = false;
try {
  await debug.mergeMarkdownWithModel({
    remote: {
      session: { prompt: async () => { overwritePromptCount += 1; }, wait: async () => ({ reason: 'idle' }) },
      workspaceFiles: { stat: async () => ({ size: 12 }) },
    },
  }, {
    sourceId: MERGE_SOURCE_ID,
    outputPath: '/x/source/existing.md',
    mode: 'same',
  });
} catch (error) {
  existingMergeRefused = String(error && error.message).includes('refusing to overwrite');
}
ok(existingMergeRefused && overwritePromptCount === 0, 'merge refuses existing output before spending model tokens');

let statFailurePromptCount = 0;
let statFailurePropagated = false;
try {
  await debug.mergeMarkdownWithModel({
    remote: {
      session: { prompt: async () => { statFailurePromptCount += 1; }, wait: async () => ({ reason: 'idle' }) },
      workspaceFiles: {
        stat: async () => {
          const denied = new Error('workspace service unavailable');
          denied.code = 'workspace-file/permission-denied';
          throw denied;
        },
      },
    },
  }, {
    sourceId: MERGE_SOURCE_ID,
    outputPath: '/x/source/merge.md',
    mode: 'same',
  });
} catch (error) {
  statFailurePropagated = String(error && error.message).includes('workspace service unavailable');
}
ok(statFailurePropagated && statFailurePromptCount === 0, 'merge propagates stat errors other than not-found without spending tokens');

globalThis.document.documentElement = { lang: 'en-US' };
ok(debug.lang() === 'en', 'Harness document language overrides the system locale');
globalThis.document.documentElement.lang = 'zh-CN';
ok(debug.lang() === 'zh', 'Harness Chinese language is recognized');

ok(
  debug.isUnstartedSessionRef({ eventSource: { value: { entries: [], hasMore: false } } }),
  'empty retained session is filtered as an unstarted lead'
);
ok(
  !debug.isUnstartedSessionRef({
    eventSource: { value: { entries: [{ event: { type: 'user/message' } }], hasMore: false } },
  }),
  'session with a user message remains visible'
);
ok(
  !debug.isUnstartedSessionRef({ eventSource: { value: { entries: [], hasMore: true } } }),
  'session with unloaded older events fails open'
);

const menuAtTop = debug.menuPositionForRect({ top: 12, bottom: 36, right: 240 }, 6, 320, 800);
ok(menuAtTop.placement === 'below' && menuAtTop.top >= 42, 'top-row menu opens below its trigger');
const menuAtBottom = debug.menuPositionForRect({ top: 760, bottom: 784, right: 300 }, 6, 320, 800);
ok(menuAtBottom.placement === 'above' && menuAtBottom.top + menuAtBottom.maxHeight <= 754, 'bottom-row menu opens above its trigger');
const menuNarrow = debug.menuPositionForRect({ top: 300, bottom: 324, right: 250 }, 6, 260, 800);
ok(menuNarrow.left >= 8 && menuNarrow.left + menuNarrow.width <= 252, 'row menu stays within narrow viewport width');
const menuShort = debug.menuPositionForRect({ top: 64, bottom: 88, right: 180 }, 20, 240, 150);
ok(menuShort.top >= 8 && menuShort.top + menuShort.maxHeight <= 142 && menuShort.maxHeight < 632, 'row menu scroll area is clamped to short viewport');

// ------------------------------------------------------------ mini renderer
function render(el) {
  if (el === null || el === undefined || el === false) return null;
  if (Array.isArray(el)) {
    const out = [];
    el.forEach((child) => {
      const r = render(child);
      if (Array.isArray(r)) out.push(...r);
      else if (r) out.push(r);
    });
    return out;
  }
  if (typeof el !== 'object') return { type: '#text', text: String(el), props: {}, children: [] };
  const props = el.props || {};
  if (typeof el.type === 'function') {
    if (el.type.prototype && el.type.prototype.isReactComponent) {
      const inst = new el.type(props);
      const out = render(inst.render());
      return Array.isArray(out) && out.length === 1 ? out[0] : out;
    }
    return render(el.type(props));
  }
  const children = [];
  (props.children || []).forEach((child) => {
    const r = render(child);
    if (Array.isArray(r)) children.push(...r);
    else if (r) children.push(r);
  });
  return { type: el.type, props, children };
}
function renderWithState(el, seed) {
  hookSeed = seed || null;
  hookIndex = 0;
  const out = render(el);
  hookSeed = null;
  hookIndex = 0;
  return out;
}
function flat(node, out = []) {
  if (!node) return out;
  const list = Array.isArray(node) ? node : [node];
  list.forEach((n) => {
    out.push(n);
    flat(n.children, out);
  });
  return out;
}
function byClass(node, cls) {
  return flat(node).filter(
    (n) => typeof n.props.className === 'string' && n.props.className.split(/\s+/).indexOf(cls) >= 0,
  );
}
function textOf(node) {
  const parts = [];
  flat(node).forEach((n) => {
    if (n.type === '#text') parts.push(n.text);
  });
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// --------------------------------------------------- pure helper behaviour
ok(debug.sanitizeName('  熊的演化  ') === '熊的演化', 'sanitize keeps CJK and trims');
ok(debug.sanitizeName('a/b:c*?"<>|') === 'abc', 'sanitize strips path characters');

const MASTER = 'session-11111111-1111-1111-1111-111111111111';
const OTHER = 'session-22222222-2222-2222-2222-222222222222';
const CHILD = 'session-33333333-3333-3333-3333-333333333333';
const WS = '/Users/baoyige/Desktop/PhD Dissertation';

const snapshot = {
  workspaces: [
    {
      workspaceId: 'ws-1',
      path: WS,
      title: 'PhD Dissertation',
      sessionIds: [MASTER, OTHER, CHILD],
    },
  ],
  sessions: {
    [MASTER]: { sessionId: MASTER, title: '制图小助手' },
    [OTHER]: { sessionId: OTHER, title: 'FTIR 成岩-地层' },
    [CHILD]: { sessionId: CHILD, title: '制图小助手 · 熊的演化' },
  },
};
const extracted = debug.extractSnapshot(snapshot);
ok(extracted.workspaces.length === 1, 'extractSnapshot finds one workspace');
ok(extracted.workspaces[0].path === WS, 'workspace path read structurally');
ok(extracted.workspaces[0].sessionIds.length === 3, 'workspace session ids read structurally');
ok(
  extracted.sessions.get(MASTER) && extracted.sessions.get(MASTER).title === '制图小助手',
  'session title read structurally',
);
ok(debug.extractSnapshot({}).workspaces.length === 0, 'empty snapshot yields no workspaces');
const activityExtraction = debug.extractSnapshot({
  sessions: {
    [MASTER]: {
      sessionId: MASTER,
      title: 'activity merge',
      updatedAt: '2026-10-01T00:00:00Z',
      updated: '2026-10-03T00:00:00Z',
      lastActivityAt: '2026-10-02T00:00:00Z',
    },
  },
});
ok(
  activityExtraction.sessions.get(MASTER).updatedAt === '2026-10-03T00:00:00Z',
  'snapshot extraction preserves the newest activity field'
);
const activityNodes = new Map([
  ['rank-root-a', { id: 'rank-root-a', children: [{ id: 'rank-level-3-a' }, { id: 'rank-level-3-b' }] }],
  ['rank-root-b', { id: 'rank-root-b', children: [] }],
  ['rank-level-3-a', { id: 'rank-level-3-a', children: [{ id: 'rank-deep-hot' }, { id: 'rank-deep-cold' }] }],
  ['rank-level-3-b', { id: 'rank-level-3-b', children: [] }],
  ['rank-deep-hot', { id: 'rank-deep-hot', children: [] }],
  ['rank-deep-cold', { id: 'rank-deep-cold', children: [] }],
]);
const activitySessions = new Map([
  ['rank-root-a', { updatedAt: 100 }],
  ['rank-root-b', { updatedAt: 800 }],
  ['rank-level-3-a', { updatedAt: 200 }],
  ['rank-level-3-b', { updatedAt: 700 }],
  ['rank-deep-hot', { updatedAt: 900 }],
  ['rank-deep-cold', { updatedAt: 400 }],
]);
const rankedRoots = debug.sortBySubtreeActivity(
  ['rank-root-b', 'rank-root-a'], activityNodes, activitySessions
);
ok(rankedRoots[0] === 'rank-root-a', 'deep activity lifts its level-two ancestor');
ok(
  debug.sortBySubtreeActivity(['rank-level-3-b', 'rank-level-3-a'], activityNodes, activitySessions)[0] === 'rank-level-3-a',
  'deep activity lifts its level-three ancestor over a hotter sibling'
);
ok(
  debug.sortBySubtreeActivity(['rank-deep-cold', 'rank-deep-hot'], activityNodes, activitySessions)[0] === 'rank-deep-hot',
  'deepest siblings sort by their own latest activity'
);
ok(
  debug.sortBySubtreeActivity(
    ['rank-root-b', 'rank-root-a'], activityNodes, activitySessions, null, (id) => id !== 'rank-deep-hot'
  )[0] === 'rank-root-b',
  'filtered descendants do not affect visible ancestor rank'
);
const tiedSessions = new Map(activitySessions);
tiedSessions.set('rank-root-b', { updatedAt: 900 });
ok(
  debug.sortBySubtreeActivity(['rank-root-b', 'rank-root-a'], activityNodes, tiedSessions)[0] === 'rank-root-b',
  'equal subtree activity preserves original sibling order'
);

// ------------------------------------------------------- fork-boundary walk
function makeSource() {
  const state = { entries: [], hasMore: true, revision: 1 };
  for (let seq = 5; seq <= 12; seq += 1) {
    state.entries.push({ type: 'event', event: { type: 'assistant/message', seq } });
  }
  state.entries[9 - 5].event.type = 'user/message';
  const session = {
    loadOlder() {
      const older = [];
      for (let seq = 1; seq <= 4; seq += 1) {
        older.push({ type: 'event', event: { type: seq === 1 ? 'user/message' : 'assistant/message', seq } });
      }
      state.entries = older.concat(state.entries);
      state.hasMore = false;
      state.revision += 1;
    },
    rename() {},
  };
  return { session, source: { value: state } };
}

const { session, source } = makeSource();
const ref = { ready: Promise.resolve(), binding: { session, eventSource: source }, release() {} };
const boundary = await debug.readForkBoundary(ref);
ok(boundary.atSeq === 8, 'boundary ends the first turn (got ' + boundary.atSeq + ')');
ok(boundary.degraded === false, 'boundary is not degraded when a second turn exists');

// ------------------------------------------------------ full create pipeline
const calls = { fork: [], rename: [], dirs: [], opened: [], workspaceRenames: [], creates: [], startSessions: [] };
const sessions = {
  retain() {
    return {
      ready: Promise.resolve(),
      binding: {
        session: {
          loadOlder() {},
          async rename(title) {
            calls.rename.push(title);
            return { title, seq: 1 };
          },
        },
        eventSource: { value: { entries: source.value.entries, hasMore: false } },
      },
      release() {},
    };
  },
  async create(options) {
    calls.creates.push(options);
    return 'session-fresh-' + calls.creates.length;
  },
  async fork(opts) {
    calls.fork.push(opts);
    return calls.fork.length === 1 ? CHILD : 'session-nested-' + calls.fork.length;
  },
};
const uiWorkspace = {
  async createDirectory(p, n) {
    calls.dirs.push([p, n]);
    return p + '/' + n;
  },
  startSession(wsId) {
    calls.startSessions.push(wsId);
    throw new Error('reuse-prone startSession must not be called by branch-tree plus actions');
  },
  openSession(id) {
    calls.opened.push(id);
  },
};
const ctx = {
  get(name) {
    if (name === 'sessions') return sessions;
    if (name === 'uiWorkspace') return uiWorkspace;
    if (name === 'workspaces') return { rename: async (id, title) => calls.workspaceRenames.push([id, title]) };
    return undefined;
  },
};

const createStart = calls.creates.length;
const freshOpenStart = calls.opened.length;
const freshOpened = [];
const firstFreshId = await debug.createFreshSession(ctx, 'ws-1', (id) => freshOpened.push(id));
const firstFreshOptions = calls.creates[createStart];
ok(firstFreshId === 'session-fresh-1' && firstFreshOptions.workspaceId === 'ws-1' && !Object.prototype.hasOwnProperty.call(firstFreshOptions, 'sessionId'), 'fresh session creation omits the reusable blank sessionId');
ok(calls.opened[freshOpenStart] === firstFreshId && freshOpened[0] === firstFreshId, 'fresh session opens and reports the exact created ID');
const secondFreshId = await debug.createFreshSession(ctx, undefined);
ok(secondFreshId !== firstFreshId && Object.keys(calls.creates[createStart + 1]).length === 0, 'root creation requests a second unique ID without workspace override');
ok(calls.startSessions.length === 0 && !/\.startSession\s*\(/.test(code), 'branch-tree plus paths never call the reuse-prone startSession');
ok((code.match(/return startFreshSession\(wsId\);/g) || []).length === 2 && code.includes('startFreshSession(own.ws);'), 'root, workspace and folder-row plus actions use the fresh-session path');

debug.resetStore();
const data = {
  workspaces: extracted.workspaces,
  sessions: extracted.sessions,
};
const res = await debug.createBranch(ctx, { id: MASTER, title: '制图小助手' }, '熊的演化', data);
ok(calls.fork.length === 1, 'fork called once');
ok(calls.fork[0].sessionId === MASTER, 'fork uses the master session');
ok(calls.fork[0].atSeq === 8, 'fork boundary came from the first-turn walk');
ok(calls.fork[0].increaseTitle === false, 'fork keeps the title so we can rename');
ok(calls.rename[0] === '熊的演化', 'top-level branch title uses only the entered name');
ok(
  calls.dirs.length === 3 &&
    calls.dirs[0][1] === '制图' &&
    calls.dirs[1][1] === '制图小助手' &&
    calls.dirs[2][1] === '熊的演化',
  'output dir chain created',
);
ok(res.dir === '制图/制图小助手/熊的演化', 'branch records the relative output dir');
const store = debug.loadStore();
ok(store.masters.length === 1 && store.masters[0].title === '制图小助手', 'master registered');
ok(store.branches.length === 1 && store.branches[0].branchId === CHILD, 'branch registered');
ok(JSON.parse(storage.get('dsh.branch-tree.v1')).branches.length === 1, 'registry persisted to localStorage');
ok(debug.groupsOf(store).roots[0].children.length === 1, 'groupsOf nests the branch under its master');

// --------------------------------------------- slot registrations via apply
const registered = [];
const injected = [];
const ctx2 = {
  get: ctx.get,
  effect(fn) {
    fn();
  },
  slots: {
    inject(name, factory) {
      injected.push(name);
      return factory();
    },
    register(opts, Component) {
      registered.push({ opts, Component });
      return () => {};
    },
  },
};
const ui = plugin;
let cssCapture = '';
globalThis.styles = {
  insert(css) {
    cssCapture = String(css);
  },
};
ui.apply(ctx2);
const open = (cssCapture.match(/{/g) || []).length;
const close = (cssCapture.match(/}/g) || []).length;
ok(open === close, 'every css rule is closed (' + open + ' / ' + close + ')');
ok(/\.dshbt-row\{[^}]*display:flex/.test(cssCapture), 'the row rule still lays out horizontally');
ok(/\.dshbt-row\{[^}]*position:relative/.test(cssCapture), 'the row rule is intact');
ok(cssCapture.includes('.dshbt-row.dshbt-active{background:rgba(0,0,0,.5);color:#fff'), 'active row uses 50%-opacity black with white text');
ok(!cssCapture.includes('box-shadow:inset 2px 0 0 #000'), 'active row has no opaque black left edge');
ok(cssCapture.includes('.dshbt-row.dshbt-active>.dshbt-title{color:#fff;font-weight:700'), 'active title is bold white text');
ok(!cssCapture.includes('dshbt-bubble'), 'tree CSS has no non-active conversation bubble styling');
ok(cssCapture.includes('.dshbt-wsw') && cssCapture.includes("font-size:13px;font-weight:600"), 'workspace selector uses the shared 13px tree font size');
ok(cssCapture.includes('.dshbt-menu-item.dshbt-cascade-trigger{display:flex'), 'cascade labels and chevrons stay on one row');
ok(cssCapture.includes('.dshbt-sb{position:relative;display:flex;') && !cssCapture.includes('z-index:2147483647') && !cssCapture.includes('overflow:visible;'), 'sidebar avoids forced overflow and runaway stacking hacks');
ok(cssCapture.includes('.dshbt-row-menu{position:fixed;top:auto;right:auto;bottom:auto;z-index:1;'), 'row menus stay above list content but below host overlays');
ok(cssCapture.includes('.dshbt-menu-ws{top:26px;right:8px;left:8px;min-width:0;z-index:5;'), 'workspace menu stays anchored under the header');
ok(cssCapture.includes('.dshbt-cascade-menu{box-sizing:border-box;max-height:min(70vh,560px);overflow-x:hidden;overflow-y:auto;'), 'expanded cascade scrolls vertically within the workspace menu');
ok(cssCapture.includes('.dshbt-cascade-workspace-entry{display:grid;') && cssCapture.includes('.dshbt-cascade-workspace-entry>.dshbt-cascade-submenu{grid-column:1 / -1;}'), 'workspace children occupy a full row below their trigger');
ok(cssCapture.includes('.dshbt-cascade-submenu{position:static;') && cssCapture.includes('margin:2px 0 4px 10px;'), 'nested cascade rows expand downward in normal flow');
ok(injected.length === 3, 'three UI slot injections');
ok(code.includes('h(IconFolderOpenRegular') && code.includes('h(IconFolderCloseRegular'), 'workspace folders use Harness native folder icons');
ok(
  injected.indexOf('sidebar.workspaces') >= 0,
  'draws the tree in the shipped sidebar seat',
);
ok(
  debug.hookKey({ useWorkspaces() {}, useSessions() {} }) === 'useWorkspaces+useSessions',
  'hookKey freezes the available hook set',
);
ok(debug.hookKey({}) === 'none', 'hookKey reports an empty set without touching hooks');
ok(
  injected.indexOf('sidebar.panellist') >= 0 && injected.indexOf('main') >= 0,
  'keeps the panel icon and the main panel',
);
const wsReg = registered.filter((r) => r.opts.name === 'sidebar.workspaces')[0];
ok(
  wsReg && typeof wsReg.opts.priority === 'number' && wsReg.opts.priority < 0,
  'sidebar tree shadows the shipped slot by going below its priorities'
);
ok(debug.version === 'v45', 'version marker v45');
// The host can already hold several priorities; a collision must degrade to the
// next candidate instead of killing the whole client module (which removes
// every seat, leaving the user with the shipped UI and no branch tree).
const retried = [];
const ctx3 = {
  get: ctx.get,
  effect(fn) {
    fn();
  },
  slots: {
    inject(name, factory) {
      return factory();
    },
    register(opts, Component) {
      if (opts.name === 'sidebar.workspaces' && opts.priority > -10) {
        throw new Error('single slot "sidebar.workspaces" already has a registration at priority ' + opts.priority);
      }
      retried.push({ opts, Component });
      return () => {};
    },
  },
};
let applyThrew = null;
try {
  ui.apply(ctx3);
} catch (e) {
  applyThrew = e;
}
ok(applyThrew === null, 'apply never throws when a seat rejects its registration');
ok(
  retried.some((r) => r.opts.name === 'sidebar.workspaces' && r.opts.priority === -10),
  'a rejected shadow priority falls back to the next candidate'
);
ok(
  retried.some((r) => r.opts.name === 'sidebar.panellist') && retried.some((r) => r.opts.name === 'main'),
  'the other seats still register after a sidebar collision'
);

const mainReg = registered.filter((r) => r.opts.name === 'main')[0];
ok(mainReg && mainReg.opts.key === 'branch-tree', 'main panel registered under key branch-tree');
const paneReg = registered.filter((r) => r.opts.name === 'sidebar.panellist')[0];
ok(paneReg && paneReg.opts.id === 'branch-tree', 'panellist id matches the main key');

// The host hooks are SELECTOR hooks: calling one without a function is exactly
// the crash the user hit ("selector is not a function"), so the stand-ins below
// enforce that contract instead of tolerating it.
function hookOf(snap) {
  return function (selector) {
    if (typeof selector !== 'function') throw new TypeError('selector is not a function');
    return selector(snap);
  };
}

// ------------------------------------------- the tree still renders (panel-side)
const Browser = ui.debug.browser;
const browser = render(Browser({ wide: true, useWorkspaces: hookOf(snapshot) }));
ok(!!browser && browser.props.className === 'dshbt-sb', 'browser renders into the sidebar column');
const activeBrowser = render(
  Browser({ wide: true, useWorkspaces: hookOf(snapshot), usePanelInfo: hookOf({ sessionId: CHILD }) }),
);
const activeRows = byClass(activeBrowser, 'dshbt-active');
ok(activeRows.length === 1, 'the current branch session is highlighted in the tree');
ok(textOf(activeRows[0]).indexOf('熊的演化') >= 0, 'the highlighted row matches the active session id');
const workspaceHeads = byClass(browser, 'dshbt-ws-head');
ok(byClass(workspaceHeads[0], 'dshbt-glyph').length === 1, 'workspace header shows a folder glyph');
ok(byClass(workspaceHeads[0], 'dshbt-count').length === 0, 'top-level workspace heading hides session/branch counts');

const folderRows = byClass(browser, 'dshbt-folder');
ok(folderRows.length === 1, 'level-two conversations with branches render as folder rows');
ok(textOf(folderRows[0]).indexOf('制图小助手') >= 0, 'folder row shows the master title');
const branchRows = byClass(browser, 'dshbt-branch');
ok(branchRows.length === 1, 'branch renders as an indented child row');
ok(textOf(branchRows[0]).indexOf('熊的演化') >= 0, 'child row shows the branch name');
ok(branchRows[0].props.className.includes('dshbt-level-three'), 'third-level branch keeps its hierarchy class');
ok(!branchRows[0].props.className.includes('dshbt-bubble'), 'third-level branch is a plain row, not a white bubble');
ok(byClass(branchRows[0], 'dshbt-bubble-title').length === 0, 'third-level title has no bubble wrapper');
ok(!branchRows[0].props.className.includes('dshbt-folder'), 'third-level branch does not become a folder row');
ok(
  branchRows[0].props.style.paddingLeft > folderRows[0].props.style.paddingLeft,
  'child row is indented relative to the level-two conversation',
);
ok(byClass(browser, 'dshbt-bubble').length === 0, 'no conversation level is rendered as a text bubble');
const plainLevelTwoRows = byClass(browser, 'dshbt-level-two').filter((row) => !row.props.className.includes('dshbt-folder'));
ok(plainLevelTwoRows.length === 1 && !plainLevelTwoRows[0].props.className.includes('dshbt-bubble'), 'branchless level-two conversations remain plain rows');
ok(byClass(browser, 'dshbt-active').length === 0, 'global session data alone does not guess which conversation is active');
ok(
  byClass(folderRows[0], 'dshbt-count').length === 0,
  'top-level conversation folder hides its branch count',
);
const countSwitch = byClass(browser, 'dshbt-count-switch')[0];
ok(!!countSwitch && countSwitch.props['aria-checked'] === true, 'branch count switch starts enabled');
countSwitch.props.onClick({ stopPropagation() {} });
const countsHidden = render(Browser({ wide: true, useWorkspaces: hookOf(snapshot) }));
ok(byClass(countsHidden, 'dshbt-folder').every((row) => byClass(row, 'dshbt-count').length === 0), 'branch count switch hides branch counts after rerender');
ok(window.localStorage.getItem('dsh.branch-tree.show-branch-counts.v1') === 'false', 'branch count switch persists its setting');
ok(byClass(browser, 'dshbt-row').length === 3, 'branch row replaces its own top-level session row');
const rail = render(Browser({ wide: false, useWorkspaces: hookOf(snapshot) }));
ok(!!rail && rail.props.className === 'dshbt-sb dshbt-narrow', 'rail mode still renders instead of blanking');
ok(byClass(rail, 'dshbt-row').length > 0, 'rail mode keeps the session rows reachable');

// -------------------------------------------------- collapse + search work
const caret = byClass(browser, 'dshbt-caret')[0];
ok(!!caret && caret.props.className.indexOf('open') >= 0, 'folder starts expanded');
ok(typeof caret.props.onClick === 'function', 'caret is interactive');

// ------------------------------------------------------ panel + diagnostics
const panel = render(mainReg.Component({ useWorkspaces: hookOf(snapshot) }));
ok(panel.props.className === 'dshbt-panel', 'panel renders');
ok(byClass(panel, 'dshbt-row').length === 3, 'panel shows the same tree');
const empty = render(Browser({ wide: true, useWorkspaces: hookOf({}) }));
ok(byClass(empty, 'dshbt-diag').length === 1, 'empty snapshot falls back to a diagnostics block');

// panel icon renders an svg
const icon = paneReg.Component({ size: 18, active: true });
ok(icon.type === 'span' && icon.props.children[0].type === 'svg', 'panel icon renders an svg');

// ------------------------------------ Zotero nesting: a branch inside a branch
debug.resetStore();
calls.fork.length = 0;
calls.dirs.length = 0;
calls.rename.length = 0;
const top = await debug.createBranch(ctx, { id: MASTER, title: '制图小助手' }, '熊的演化', data);
ok(top.parentId === MASTER, 'a top-level branch points at its master');
ok(top.dir === '制图/制图小助手/熊的演化', 'top-level branch dir mirrors the master');
const nested = await debug.createBranch(
  ctx,
  { id: top.branchId, title: '熊的演化' },
  '头骨图',
  data,
  {
    id: top.branchId,
    parentId: top.branchId,
    masterId: top.masterId,
    masterTitle: top.masterTitle,
    parentDir: top.dir,
  }
);
ok(calls.rename[1] === '头骨图', 'nested branch title uses only the entered name');
ok(nested.parentId === top.branchId, 'a sub-branch remembers its parent branch');
ok(nested.dir === '制图/制图小助手/熊的演化/头骨图', 'sub-branch dir nests one level deeper');
ok(calls.fork[1].sessionId === top.branchId, 'a sub-branch forks from its parent branch');
const recencyStoreBefore = debug.loadStore();
const siblingTopId = 'session-44444444-4444-4444-4444-444444444444';
const siblingDeepId = 'session-55555555-5555-5555-5555-555555555555';
const siblingTop = Object.assign({}, top, {
  branchId: siblingTopId,
  name: '岩层脉络',
  dir: '制图/制图小助手/岩层脉络',
});
const siblingDeep = Object.assign({}, nested, {
  branchId: siblingDeepId,
  name: '骨骼',
  dir: '制图/制图小助手/熊的演化/骨骼',
});
debug.saveStore(Object.assign({}, recencyStoreBefore, {
  branches: recencyStoreBefore.branches.concat([siblingTop, siblingDeep]),
}));
const forest = debug.groupsOf(debug.loadStore());
const masterNode = forest.byId.get(MASTER);
ok(
  masterNode.children.length === 2 &&
    masterNode.children[0].children.length === 2 &&
    masterNode.children[0].children.some((child) => child.name === '头骨图'),
  'the forest nests branch inside branch and preserves sibling branches'
);
const activitySnapshot = Object.assign({}, snapshot, {
  sessions: Object.assign({}, snapshot.sessions, {
    [MASTER]: Object.assign({}, snapshot.sessions[MASTER], { updatedAt: '2026-10-01T00:00:00Z' }),
    [OTHER]: Object.assign({}, snapshot.sessions[OTHER], { updatedAt: '2026-10-27T00:00:00Z' }),
    [top.branchId]: { sessionId: top.branchId, title: '熊的演化', updatedAt: '2026-10-02T00:00:00Z' },
    [nested.branchId]: { sessionId: nested.branchId, title: '头骨图', updatedAt: '2026-10-05T00:00:00Z' },
    [siblingTopId]: { sessionId: siblingTopId, title: '岩层脉络', updatedAt: '2026-10-25T00:00:00Z' },
    [siblingDeepId]: { sessionId: siblingDeepId, title: '骨骼', updatedAt: '2026-10-29T00:00:00Z' },
  }),
});
const activityTree = render(Browser({ wide: true, useWorkspaces: hookOf(activitySnapshot) }));
const activityRows = byClass(activityTree, 'dshbt-row');
const activityFolder = byClass(activityTree, 'dshbt-folder')[0];
const activityOther = activityRows.find((row) => textOf(row).indexOf('FTIR 成岩-地层') >= 0);
ok(
  activityRows.indexOf(activityFolder) < activityRows.indexOf(activityOther),
  'newest deep activity lifts its level-two conversation above a hotter root sibling'
);
const activityBranchRows = byClass(activityTree, 'dshbt-branch');
const activityLevelThree = activityBranchRows.filter((row) => row.props.className.includes('dshbt-level-three'));
const activityLevelFour = activityBranchRows.filter((row) => !row.props.className.includes('dshbt-level-three'));
ok(
  textOf(activityLevelThree[0]).indexOf('熊的演化') >= 0 && textOf(activityLevelThree[1]).indexOf('岩层脉络') >= 0,
  'deep activity lifts its level-three ancestor above a hotter sibling branch'
);
ok(
  textOf(activityLevelFour[0]).indexOf('骨骼') >= 0 && textOf(activityLevelFour[1]).indexOf('头骨图') >= 0,
  'deepest sibling rows sort by their own latest activity'
);
debug.saveStore(recencyStoreBefore);
const deep = render(Browser({ wide: true, useWorkspaces: hookOf(snapshot) }));
const deepFolders = byClass(deep, 'dshbt-folder');
ok(deepFolders.length === 1, 'only the level-two conversation with child branches renders as a folder');
ok(byClass(deep, 'dshbt-row').length === 4, 'every node gets a row at full depth');
const deepBranchRows = byClass(deep, 'dshbt-branch');
const thirdLevelRows = deepBranchRows.filter((row) => row.props.className.includes('dshbt-level-three'));
const fourthLevelRows = deepBranchRows.filter((row) => !row.props.className.includes('dshbt-level-three'));
ok(thirdLevelRows.length === 1 && byClass(thirdLevelRows[0], 'dshbt-bubble-title').length === 0, 'third-level branches remain plain rows');
ok(fourthLevelRows.length === 1, 'fourth-level and deeper nodes keep the branch row treatment');
ok(byClass(deep, 'dshbt-bubble').length === 0, 'no branch depth adds a non-active bubble');

// ------------------------------------------------ cascade menu interaction
const cascadeTree = (path) => renderWithState(
  Browser({ wide: true, useWorkspaces: hookOf(snapshot) }),
  { 12: true, 13: path }
);
const workspaceClosed = cascadeTree([]);
const wsEntryClosed = byClass(workspaceClosed, 'dshbt-cascade-workspace-entry')[0];
const wsTriggerClosed = byClass(wsEntryClosed, 'dshbt-cascade-trigger')[0];
ok(!!wsEntryClosed && !!wsTriggerClosed, 'workspace trigger renders in the root menu');
ok(!wsEntryClosed.props.onMouseEnter && !wsTriggerClosed.props.onFocus, 'workspace branches do not expand on hover or focus');
const wsExpandStart = stateWrites.length;
wsTriggerClosed.props.onClick();
ok(
  stateWrites.slice(wsExpandStart).some((write) => write && write.index === 13 && JSON.stringify(write.next) === JSON.stringify(['ws:ws-1'])),
  'workspace click opens its cascade path'
);
const workspaceOpen = cascadeTree(['ws:ws-1']);
const wsEntry = byClass(workspaceOpen, 'dshbt-cascade-workspace-entry')[0];
const wsTrigger = byClass(wsEntry, 'dshbt-cascade-trigger')[0];
ok(!!wsEntry && !!wsTrigger && wsTrigger.props['aria-expanded'] === true, 'workspace click reveals its submenu');
const wsCollapseStart = stateWrites.length;
wsTrigger.props.onClick();
ok(
  stateWrites.slice(wsCollapseStart).some((write) => write && write.index === 13 && JSON.stringify(write.next) === JSON.stringify([])),
  'clicking an expanded workspace collapses its path'
);
const masterTrigger = byClass(workspaceOpen, 'dshbt-cascade-trigger').find((node) => textOf(node) === '制图小助手');
ok(!!masterTrigger, 'workspace submenu contains the master session');
ok(!masterTrigger.props.onMouseEnter && !masterTrigger.props.onFocus, 'session branches expand only by activation');
const masterExpandStart = stateWrites.length;
masterTrigger.props.onClick();
ok(
  stateWrites.slice(masterExpandStart).some((write) => write && write.index === 13 && JSON.stringify(write.next) === JSON.stringify(['ws:ws-1', 'session:' + MASTER])),
  'master-session click appends to the existing workspace path'
);
const escapeStart = stateWrites.length;
byClass(workspaceOpen, 'dshbt-menu-ws')[0].props.onKeyDown({ key: 'Escape' });
ok(
  stateWrites.slice(escapeStart).some((write) => write && write.index === 13 && JSON.stringify(write.next) === JSON.stringify([])),
  'Escape clears the cascade path to an empty array'
);
ok(
  byClass(workspaceOpen, 'dshbt-cascade-trigger').every((node) => !node.props.title),
  'workspace and session cascade entries do not create native tooltips'
);
const openStart = calls.opened.length;
const otherTrigger = byClass(workspaceOpen, 'dshbt-cascade-trigger').find((node) => textOf(node) === 'FTIR 成岩-地层');
otherTrigger.props.onClick();
ok(calls.opened.length === openStart + 1 && calls.opened[openStart] === OTHER, 'leaf click opens the exact session id');

const masterOpen = cascadeTree(['ws:ws-1', 'session:' + MASTER]);
const topTrigger = byClass(masterOpen, 'dshbt-cascade-trigger').find((node) => textOf(node) === '熊的演化');
ok(!!topTrigger, 'first-level branch appears inside its master session');
ok(!topTrigger.props.onMouseEnter && !topTrigger.props.onFocus, 'nested branch does not expand on hover or focus');
const nestedPathStart = stateWrites.length;
const openBeforeNestedPath = calls.opened.length;
topTrigger.props.onClick();
ok(
  stateWrites.slice(nestedPathStart).some((write) => write && write.index === 13 && JSON.stringify(write.next) === JSON.stringify(['ws:ws-1', 'session:' + MASTER, 'session:' + top.branchId])) && calls.opened.length === openBeforeNestedPath,
  'branch click appends its full ancestor path without opening the branch session'
);
const nestedMenu = cascadeTree(['ws:ws-1', 'session:' + MASTER, 'session:' + top.branchId]);
ok(
  byClass(nestedMenu, 'dshbt-cascade-trigger').every((node) => !node.props.title),
  'nested cascade entries do not create native tooltips'
);
const nestedTrigger = byClass(nestedMenu, 'dshbt-cascade-trigger').find((node) => textOf(node) === '头骨图');
ok(!!nestedTrigger, 'deep branch appears after clicking each ancestor');
const nestedOpenStart = calls.opened.length;
nestedTrigger.props.onClick();
ok(
  calls.opened.length === nestedOpenStart + 1 && calls.opened[nestedOpenStart] === nested.branchId,
  'deepest leaf click opens its exact session id'
);

const oldPrompt = window.prompt;
window.prompt = () => 'PhD Dissertation renamed';
const renameTree = cascadeTree([]);
const renameButton = byClass(renameTree, 'dshbt-icon-btn').find((node) => node.props.title === '重命名');
ok(!!renameButton, 'workspace cascade exposes a rename action');
renameButton.props.onClick({ stopPropagation() {} });
await Promise.resolve();
window.prompt = oldPrompt;
ok(
  calls.workspaceRenames.some((entry) => entry[0] === 'ws-1' && entry[1] === 'PhD Dissertation renamed'),
  'workspace rename calls the host service with workspace id and title'
);

// A titleless session placeholder is seeded by the workspace itself, so the
// sessions snapshot must still be merged in: this is what used to be skipped.
const merged = debug.mergeHostData(
  { workspaces: [{ workspaceId: 'w1', path: '/x', title: 'PhD Dissertation', sessionIds: [MASTER, OTHER] }] },
  {
    byId: {
      [MASTER]: { id: MASTER, title: '制图小助手', blank: false },
      [OTHER]: { id: OTHER.replace('session-', ''), title: '文章小助手', blank: false },
    },
  }
);
ok(merged.sessions.get(MASTER).title === '制图小助手', 'merge keeps the workspace-seeded title');
ok(
  merged.sessions.get(OTHER).title === '文章小助手',
  'merge picks up a title keyed by a bare uuid'
);
const freshestActivityMerge = debug.mergeHostData(
  {
    workspaces: [{ workspaceId: 'w1', path: '/x', title: 'PhD Dissertation', sessionIds: [MASTER] }],
    sessions: {
      [MASTER]: { sessionId: MASTER, title: '制图小助手', updatedAt: '2026-10-20T00:00:00Z' },
    },
  },
  { byId: { [MASTER]: { id: MASTER, title: '制图小助手', updatedAt: '2026-10-29T00:00:00Z' } } }
);
ok(
  freshestActivityMerge.sessions.get(MASTER).updatedAt === '2026-10-29T00:00:00Z',
  'session snapshot keeps its newer activity over stale workspace metadata'
);

// Drag-and-drop reparenting: adopting a plain session into a folder, nesting a
// branch under another branch, and refusing cycles.
const M2 = 'session-99999999-1111-2222-3333-444444444444';
const Z = 'session-88888888-1111-2222-3333-444444444444';
const dragStore = { masters: [{ id: MASTER, title: '制图小助手' }], branches: [] };
const titleMap = {};
titleMap[MASTER] = '制图小助手';
titleMap[Z] = 'zotero 里的对话';
ok(
  debug.nestUnder(dragStore, Z, MASTER, (x) => titleMap[x] || x),
  'a plain session can be adopted under a folder session'
);
const adopted = dragStore.branches[0];
ok(adopted.branchId === Z && adopted.parentId === MASTER, 'adopted entry points at the target');
const dragForest = debug.groupsOf(dragStore);
ok(
  dragForest.byId.get(MASTER).children.length === 1 &&
    dragForest.byId.get(MASTER).children[0].id === Z,
  'the adopted session renders as a child of the folder'
);
ok(debug.nestUnder(dragStore, M2, Z, (x) => titleMap[x] || x), 'a branch can hold its own child');
ok(debug.groupsOf(dragStore).byId.get(Z).children[0].id === M2, 'grandchild lands one level deeper');
ok(!debug.canNest(dragStore, Z, M2), 'a node cannot be moved inside its own child');
ok(!debug.canNest(dragStore, Z, Z), 'a node cannot be moved inside itself');
ok(debug.detachEntry(dragStore, M2), 'a node can be detached from the tree');
ok(dragStore.branches.length === 1 && dragStore.branches[0].branchId === Z, 'detach removes only that entry');
const dragRows = render(Browser({ wide: true, useWorkspaces: hookOf(snapshot) }));
ok(byClass(dragRows, 'dshbt-row').length >= 1, 'rows still render with drag handlers attached');

// A folder node may own a real directory + its own workspace.
ok(debug.childDir('/x/PhD', 'ZooMS') === '/x/PhD/ZooMS', 'childDir hangs the folder under its parent');
ok(debug.childDir('/x/PhD/', 'a/b') === '/x/PhD/ab', 'childDir sanitizes and trims slashes');
const owned = {
  masters: [{ id: MASTER, title: '制图小助手' }],
  branches: [],
  folders: { [MASTER]: { dir: '/x/PhD/制图小助手', ws: 'w-sub' } },
};
ok(debug.folderOf(owned, MASTER).ws === 'w-sub', 'folderOf reads the binding');
ok(debug.boundWorkspaceIds(owned).has('w-sub'), 'a bound workspace is claimed by its folder');
ok(debug.setFolder(owned, 'other', { dir: '/x/other' }).dir === '/x/other', 'setFolder merges patch');
const persisted = JSON.parse(JSON.stringify(owned));
ok(persisted.folders[MASTER].dir === '/x/PhD/制图小助手', 'folder bindings survive persistence');

// A partial store write must not wipe the tables it does not mention.
debug.resetStore();
debug.patchStore({ folders: { n1: { dir: '/tmp/x', ws: 'ws-1' } } });
debug.patchStore({ branches: [] });
ok(debug.loadStore().folders.n1.dir === '/tmp/x', 'patchStore keeps the folders table');
debug.unstow('n1');
ok(!debug.loadStore().folders.n1, 'unstow drops the folder binding');
debug.resetStore();
debug.patchStore({ hidden: ['ws-hidden'] });
const hiddenSnapshot = {
  workspaces: [
    { workspaceId: 'ws-hidden', path: '/a', title: '记忆中枢', sessionIds: [OTHER] },
    { workspaceId: 'ws-2', path: '/b', title: 'PhD Dissertation', sessionIds: [MASTER] },
  ],
  byId: {},
};
const hiddenTree = render(Browser({ wide: true, useWorkspaces: hookOf(hiddenSnapshot) }));
const wsHeads = byClass(hiddenTree, 'dshbt-ws-title').map(textOf);
ok(
  wsHeads.indexOf('记忆中枢') < 0 && wsHeads.indexOf('PhD Dissertation') >= 0,
  'a hidden workspace disappears from the tree'
);
debug.resetStore();

// Archived sessions must not be drawn even though the host keeps them in
// workspace.sessionIds; the plugin keeps its own record for them.
debug.resetStore();
debug.patchStore({
  archived: [OTHER],
  archiveBox: { [OTHER]: { id: OTHER, title: 'Plain session', dir: WS, at: 1 } },
});
const archivedTree = render(Browser({ wide: true, useWorkspaces: hookOf(hiddenSnapshot) }));
const archiveViewport = byClass(archivedTree, 'dshbt-rows')[0];
ok(
  !!archiveViewport && byClass(archiveViewport, 'dshbt-arc').length === 1,
  'the archive section stays inside the bounded scrolling list'
);
ok(
  byClass(archivedTree, 'dshbt-row').every(function (r) {
    return textOf(r).indexOf('Plain session') < 0 && textOf(r).indexOf(OTHER.slice(-6)) < 0;
  }),
  'a locally archived session disappears from the tree'
);
debug.resetStore();

// If the host ever exposes an archived marker on the session record, honour it too.
const hostArchivedSnap = {
  workspaces: [{ workspaceId: 'ws-2', path: '/b', title: 'PhD Dissertation', sessionIds: [MASTER, OTHER] }],
  byId: { [OTHER]: { id: OTHER, title: 'Zotero', archived: true } },
};
const hostArchivedTree = render(Browser({ wide: true, useWorkspaces: hookOf(hostArchivedSnap) }));
ok(
  JSON.stringify(byClass(hostArchivedTree, 'dshbt-title').map(textOf)).indexOf('Zotero') < 0,
  'a host-flagged archived session is filtered out'
);
debug.resetStore();

// Drag a plain session row onto a folder row, exactly as the DOM would.
debug.resetStore();
const dragSnap = {
  workspaces: [{ workspaceId: 'w1', path: '/x', title: 'PhD Dissertation', sessionIds: [MASTER, OTHER] }],
  byId: {
    [MASTER]: { id: MASTER, title: '制图小助手', blank: false },
    [OTHER]: { id: OTHER, title: '文章小助手', blank: false },
  },
};
const dragTree = render(Browser({ wide: true, useWorkspaces: hookOf(dragSnap), useSessions: hookOf(dragSnap) }));
const rows = byClass(dragTree, 'dshbt-row');
const sourceRow = rows[0];
const targetRow = rows[1];
ok(!!targetRow && !!sourceRow, 'both rows render');
ok(sourceRow && sourceRow.props && sourceRow.props.draggable === true, 'rows stay draggable');
const dt = { store: {}, setData: function (k, v) { this.store[k] = v; }, getData: function (k) { return this.store[k] || ''; }, effectAllowed: '' };
const evt = function () {
  return { preventDefault: function () {}, stopPropagation: function () {}, dataTransfer: dt };
};
const writesBeforeDrop = stateWrites.length;
if (sourceRow && targetRow) {
  sourceRow.props.onDragStart(evt());
  targetRow.props.onDragOver(evt());
  targetRow.props.onDrop(evt());
}
ok(debug.loadStore().branches.length === 0, 'dragging a session onto another does not change hierarchy before choice');
ok(
  stateWrites.slice(writesBeforeDrop).some((write) => write && write.next && write.next.sourceId === MASTER && write.next.targetId === OTHER),
  'dragging a session onto another opens the merge-mode chooser'
);

console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE OK (' + log.length + ' checks)');

// A workspace that reports archivedSessionIds must hide those sessions.
const archSnap = {
  workspaces: [
    {
      workspaceId: 'ws-2',
      path: '/b',
      title: 'PhD Dissertation',
      sessionIds: [MASTER],
      archivedSessionIds: [OTHER],
    },
  ],
  byId: { [OTHER]: { id: OTHER, title: 'Zotero' } },
};
const archTree = render(Browser({ wide: true, useWorkspaces: hookOf(archSnap), useSessions: hookOf(archSnap) }));
ok(
  JSON.stringify(byClass(archTree, 'dshbt-title').map(textOf)).indexOf('Zotero') < 0,
  'archivedSessionIds from the host hides the session'
);
ok(debug.mergeHostData(archSnap, archSnap, null, null, null).sessions.get(OTHER).archived === true, 'archived marker survives the merge');

const ORDER_OLD = 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORDER_NEW = 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ORDER_MID = 'session-cccccccc-cccc-cccc-cccc-cccccccccccc';
const orderIds = [ORDER_OLD, ORDER_NEW, ORDER_MID];
const orderSnap = {
  workspaces: [{ workspaceId: 'ws-order', path: '/order', title: 'Order', sessionIds: orderIds }],
  sessions: {
    [ORDER_OLD]: { id: ORDER_OLD, title: 'Older', updatedAt: '2026-10-01T00:00:00Z' },
    [ORDER_NEW]: { id: ORDER_NEW, title: 'Newest', updatedAt: '2026-10-28T00:00:00Z' },
    [ORDER_MID]: { id: ORDER_MID, title: 'Middle', updatedAt: '2026-10-15T00:00:00Z' },
  },
};
const orderTree = render(Browser({ wide: true, useWorkspaces: hookOf(orderSnap), useSessions: hookOf(orderSnap) }));
ok(
  byClass(orderTree, 'dshbt-title').map(textOf).join(',') === 'Newest,Middle,Older',
  'workspace sessions sort by latest update descending'
);

console.log(log.join('\n'));
console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE OK (' + log.length + ' checks)');
