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
ok(
  plugin.inject.includes('slots') &&
    plugin.inject.includes('remote') &&
    plugin.inject.includes('remote.session') &&
    plugin.inject.includes('remote.workspaceFiles'),
  'plugin injects slots and remote APIs'
);
const clientInject = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).dsh.client.inject;
ok(clientInject.includes('@deepseek-ai/dsh-client-ui-sidebar'), 'client manifest injects the sidebar slot provider');
ok(clientInject.includes('@deepseek-ai/dsh-client-ui-primitives'), 'client manifest injects Harness native UI primitives');
ok(clientInject.includes('@deepseek-ai/dsh-api-session-controller'), 'client manifest injects the session prompt/wait API');
ok(clientInject.includes('@deepseek-ai/dsh-api-workspace-files'), 'client manifest injects the workspace-files stat API');

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
ok(
  calls.fork[0].atSeq === 12,
  'default branch forks verbatim at the master\'s last dialogue event, not at the end of turn 1 (got ' + calls.fork[0].atSeq + ')'
);
ok(
  calls.fork[0].increaseTitle === undefined && calls.fork[0].sessionId === MASTER,
  'fork sends only the fields the remote schema accepts'
);
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
ok(/^v[0-9]+$/.test(debug.version), 'version marker is a v-number (' + debug.version + ')');
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
  { 10: true, 11: path }
);
const workspaceClosed = cascadeTree([]);
const wsEntryClosed = byClass(workspaceClosed, 'dshbt-cascade-workspace-entry')[0];
const wsTriggerClosed = byClass(wsEntryClosed, 'dshbt-cascade-trigger')[0];
ok(!!wsEntryClosed && !!wsTriggerClosed, 'workspace trigger renders in the root menu');
ok(!wsEntryClosed.props.onMouseEnter && !wsTriggerClosed.props.onFocus, 'workspace branches do not expand on hover or focus');
const wsExpandStart = stateWrites.length;
wsTriggerClosed.props.onClick();
ok(
  stateWrites.slice(wsExpandStart).some((write) => write && write.index === 11 && JSON.stringify(write.next) === JSON.stringify(['ws:ws-1'])),
  'workspace click opens its cascade path'
);
const workspaceOpen = cascadeTree(['ws:ws-1']);
const wsEntry = byClass(workspaceOpen, 'dshbt-cascade-workspace-entry')[0];
const wsTrigger = byClass(wsEntry, 'dshbt-cascade-trigger')[0];
ok(!!wsEntry && !!wsTrigger && wsTrigger.props['aria-expanded'] === true, 'workspace click reveals its submenu');
const wsCollapseStart = stateWrites.length;
wsTrigger.props.onClick();
ok(
  stateWrites.slice(wsCollapseStart).some((write) => write && write.index === 11 && JSON.stringify(write.next) === JSON.stringify([])),
  'clicking an expanded workspace collapses its path'
);
const masterTrigger = byClass(workspaceOpen, 'dshbt-cascade-trigger').find((node) => textOf(node) === '制图小助手');
ok(!!masterTrigger, 'workspace submenu contains the master session');
ok(!masterTrigger.props.onMouseEnter && !masterTrigger.props.onFocus, 'session branches expand only by activation');
const masterExpandStart = stateWrites.length;
masterTrigger.props.onClick();
ok(
  stateWrites.slice(masterExpandStart).some((write) => write && write.index === 11 && JSON.stringify(write.next) === JSON.stringify(['ws:ws-1', 'session:' + MASTER])),
  'master-session click appends to the existing workspace path'
);
const escapeStart = stateWrites.length;
byClass(workspaceOpen, 'dshbt-menu-ws')[0].props.onKeyDown({ key: 'Escape' });
ok(
  stateWrites.slice(escapeStart).some((write) => write && write.index === 11 && JSON.stringify(write.next) === JSON.stringify([])),
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
  stateWrites.slice(nestedPathStart).some((write) => write && write.index === 11 && JSON.stringify(write.next) === JSON.stringify(['ws:ws-1', 'session:' + MASTER, 'session:' + top.branchId])) && calls.opened.length === openBeforeNestedPath,
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

const renameTree = cascadeTree([]);
const renameButton = byClass(renameTree, 'dshbt-icon-btn').find((node) => node.props.title === '重命名');
ok(!renameButton, 'workspace cascade does not expose a rename action');

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
ok(debug.loadStore().branches.length === 0, 'plain drag does not change hierarchy; nesting requires Alt');
ok(
  !stateWrites.slice(writesBeforeDrop).some((write) => write && write.next && write.next.sourceId === MASTER && write.next.targetId === OTHER),
  'plain drag does not invoke or prompt a merge action'
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

// ------------------------------------------------- inherited memory mode
// "Inherit everything, compressed": the branch must fork at the master's LAST
// event (not the end of turn 1), get a digest of the whole master, and receive
// that digest as its own seed so it never reads the master again.
// An assistant turn as DSH actually stores it: the parts sit one level down,
// under `data.message.content`, with the model/provider metadata beside them.
// Reading `data.content` alone is how every assistant reply got lost.
function assistant(seq, text, turn) {
  return {
    type: 'event',
    event: {
      type: 'assistant/message',
      seq,
      data: {
        turn: turn || 1,
        step: 1,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text }],
          source: { kind: 'model', provider: 'p', model: 'm' },
        },
      },
    },
  };
}
// A host-injected block: same `user/message` type, different kind. These are
// another session's runtime policy and skill catalog, never a user turn.
function hostBlock(seq, kind, text) {
  return {
    type: 'event',
    event: {
      type: 'user/message',
      seq,
      data: { content: [{ type: 'text', text }], source: { kind }, role: 'user' },
    },
  };
}
function turnEnd(seq, turn) {
  return { type: 'event', event: { type: 'turn/end', seq, data: { turn, reason: 'completed' } } };
}

function makeInheritSource() {
  let entries = [];
  const state = { get entries() { return entries; }, set entries(v) { entries = v; }, hasMore: true, revision: 0 };
  // First page: seq 20..31, two later user turns (23, 27) so the old
  // first-turn walk would stop at 22.
  state.entries.push({
    type: 'event',
    event: {
      type: 'user/message',
      seq: 20,
      data: { content: [{ type: 'text', text: '第一个需求：做分叉插件' }], source: { kind: 'user' } },
    },
  });
  for (let seq = 21; seq <= 31; seq += 1) {
    if (seq === 24 || seq === 25) {
      state.entries.push(
        hostBlock(
          seq,
          seq === 24 ? 'runtime-context' : 'skill-catalog',
          seq === 24 ? 'Current runtime context. 沙箱 policy 与工作区路径。' : '<system-reminder> 技能目录 </system-reminder>'
        )
      );
      continue;
    }
    if (seq === 23 || seq === 27) {
      state.entries.push({
        type: 'event',
        event: {
          type: 'user/message',
          seq,
          data: {
            content: [{ type: 'text', text: seq === 23 ? '第三个需求：压缩继承做成可选项' : '第四个需求：分支独立跑' }],
            source: { kind: 'user' },
          },
        },
      });
      continue;
    }
    // The host only forks a completed-turn prefix (every turn/end), and the
    // plugin now resolves to exactly that seq, so the fixture carries a real
    // turn/end instead of a wall of assistant replies (seq 28).
    // Two completed turns: seq 22 closes turn 1 (the "opening only" cut) and
    // seq 28 closes turn 2 (the newest prefix the host will copy).
    state.entries.push(seq === 22 ? turnEnd(seq, 1) : seq === 28 ? turnEnd(seq, 2) : assistant(seq, '回复 ' + seq));
  }
  const session = {
    loadOlder() {
      const older = [];
      for (let seq = 1; seq <= 19; seq += 1) {
        older.push({
          type: 'event',
          event: {
            type: seq % 2 === 1 ? 'user/message' : 'assistant/message',
            seq,
            data: { content: [{ type: 'text', text: '旧事件 ' + seq }] },
          },
        });
      }
      state.entries = older.concat(state.entries);
      state.hasMore = false;
      state.revision += 1;
    },
    rename() {},
  };
  return { session, source: { value: state } };
}

{
  const { session: isSession, source: isSource } = makeInheritSource();
  const isRef = { ready: Promise.resolve(), binding: { session: isSession, eventSource: isSource }, release() {} };
  const ib = await debug.readInheritBoundary(isRef);
  ok(
    ib.atSeq === 31,
    'inherit boundary keeps the last message when it is inside the completed turn (got ' + ib.atSeq + ')'
  );
  ok(ib.turns === 13, 'inherit boundary counts only the real user turns, not injected blocks (got ' + ib.turns + ')');
  ok(ib.degraded === false, 'inherit boundary is not degraded once a user turn exists');

  // The mechanical digest must cover the whole prefix, not stop at turn 1.
  const all = [];
  for (let seq = 1; seq <= 31; seq += 1) {
    all.push({
      event: {
        type: seq % 2 === 1 ? 'user/message' : 'assistant/message',
        seq,
        data: { content: [{ type: 'text', text: '事件内容 ' + seq }] },
      },
    });
  }
  const md = debug.mechanicalDigest(all, 31);
  ok(md.indexOf('事件内容 31') >= 0 && md.indexOf('事件内容 1') >= 0, 'mechanical digest keeps both the opening and the latest turn');

  // Host-injected blocks (runtime context, skill catalog, time) must never be
  // mistaken for something the user said.
  const seeded = all.concat([
    { event: { type: 'user/message', seq: 32, data: { content: [{ type: 'text', text: 'Current runtime context. INJECTED-RUNTIME' }], source: { kind: 'runtime-context' } } } },
    { event: { type: 'user/message', seq: 33, data: { content: [{ type: 'text', text: '<!-- dsh-runtime:seed --> INJECTED-MARKER' }] } } },
    { event: { type: 'user/message', seq: 34, data: { content: [{ type: 'text', text: '[记忆定位 — 读法] INJECTED-MEMORY' }] } } },
  ]);
  const seamd = debug.mechanicalDigest(seeded, 34);
  ok(
    seamd.indexOf('INJECTED-RUNTIME') < 0 && seamd.indexOf('INJECTED-MARKER') < 0 && seamd.indexOf('INJECTED-MEMORY') < 0,
    'mechanical digest skips host-injected blocks'
  );
  ok(debug.isSeedUserEntry(seeded[31]) && debug.isSeedUserEntry(seeded[32]) && debug.isSeedUserEntry(seeded[33]), 'isSeedUserEntry flags every injected block shape');
  ok(!debug.isSeedUserEntry(seeded[0]), 'isSeedUserEntry leaves real user turns alone');
  ok(debug.seedBlockHeaders.length > 0, 'seed block headers are exposed for the matcher');

  // A master whose real messages are all user turns and no assistant reply yet
  // still has to cut somewhere sensible.
  const onlyUser = {
    value: {
      entries: [
        {
          type: 'event',
          event: { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '第一句需求' }], source: { kind: 'user' } } },
        },
        hostBlock(2, 'runtime-context', 'Current runtime context. 无关块'),
        {
          type: 'event',
          event: { type: 'user/message', seq: 3, data: { content: [{ type: 'text', text: '第二句需求' }], source: { kind: 'user' } } },
        },
      ],
      hasMore: false,
    },
  };
  onlyUser.session = { loadOlder() {}, async rename(t) { return { title: t, seq: 1 }; } };
  const ouRef = { ready: Promise.resolve(), binding: { session: onlyUser.session, eventSource: { value: onlyUser.value } }, release() {} };
  const oub = await debug.readInheritBoundary(ouRef);
  ok(oub.atSeq === 3, 'a master with no assistant reply cuts at its last user message (got ' + oub.atSeq + ')');
  ok(oub.turns === 2, 'injected blocks do not inflate the turn count (got ' + oub.turns + ')');
  ok(oub.degraded === false, 'a user-only master is not degraded');
  ok(md.length <= 12500, 'mechanical digest stays inside its character budget (got ' + md.length + ')');
  ok(debug.mechanicalDigest(all, 5).indexOf('事件内容 9') < 0, 'mechanical digest respects the fork seq');

  const prompt = debug.compressionPrompt('制图小助手', 31, 9, md);
  ok(prompt.indexOf('制图小助手') >= 0 && prompt.indexOf('第 31 个事件') >= 0, 'compression prompt names the master and the fork event');
  ok(/## 任务目标/.test(prompt) && /## 重要锚点/.test(prompt), 'compression prompt demands the resume-ready sections');

  const seed = debug.seedText({ sourceTitle: '制图小助手', atSeq: 31 }, '## 任务目标\n做插件');
  ok(seed.indexOf('dsh-branch-tree:seed') >= 0 && seed.indexOf('atSeq=31') >= 0, 'seed carries a machine-readable branch marker');
  ok(seed.indexOf('## 任务目标') >= 0, 'seed embeds the digest body');

  // clip keeps head and tail, and messageText reads the text parts.
  const long = 'A'.repeat(500) + 'B'.repeat(500);
  const clipped = debug.clip(long, 100);
  ok(clipped.length < long.length && clipped.indexOf('AAAA') === 0 && clipped.indexOf('BBBB') > 0, 'clip keeps the head and the tail');
  ok(
    debug.messageText({ event: { data: { content: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] } } }) === 'x\ny',
    'messageText joins the text parts of a message'
  );
}

// End-to-end: default draft mode is inherit; the prompt/wait round-trip writes
// the digest into the child and the stored entry records the digest source.
{
  const { session: e2eSession, source: e2eSource } = makeInheritSource();
  const e2e = { fork: [], prompt: [], wait: [], rename: [], dirs: [] };
  const e2eSessions = {
    retain() {
      return {
        ready: Promise.resolve(),
        binding: {
          session: Object.assign({}, e2eSession, {
            async rename(title) {
              e2e.rename.push(title);
            },
          }),
          eventSource: e2eSource,
        },
        release() {},
      };
    },
    async fork(opts) {
      e2e.fork.push(opts);
      return 'session-inherit-child';
    },
    async create() {
      return 'session-scratch-digest';
    },
    async archiveSession() {},
    async prompt(options) {
      e2e.prompt.push(options);
      return { accepted: true };
    },
    async wait(options) {
      e2e.wait.push(options);
      return { ok: true };
    },
  };
  const e2eUi = {
    async createDirectory(p, n) {
      e2e.dirs.push([p, n]);
      return p + '/' + n;
    },
    openSession() {},
  };
  const e2eCtx = {
    get(name) {
      if (name === 'sessions') return e2eSessions;
      if (name === 'uiWorkspace') return e2eUi;
      if (name === 'workspaces') return { rename: async () => {} };
      return undefined;
    },
  };
  debug.resetStore();
  const e2eData = { workspaces: extracted.workspaces, sessions: extracted.sessions };
  const e2eEntry = await debug.createBranch(
    e2eCtx,
    { id: MASTER, title: '制图小助手' },
    '压缩继承分支',
    e2eData,
    { inheritMode: 'inherit' }
  );
  ok(
    e2e.fork.length === 1 && e2e.fork[0].atSeq === 0,
    'inherit fork starts empty so no raw history travels (got ' + (e2e.fork[0] || {}).atSeq + ')'
  );
  ok(e2eEntry.inheritMode === 'inherit', 'stored entry records the compressed mode');
  ok(!e2e.prompt.some((p) => p.sessionId === MASTER), 'the master is never prompted, so its own conversation stays clean');
  const compressPrompt = e2e.prompt.find((p) => p.sessionId === 'session-scratch-digest');
  ok(
    !!compressPrompt && compressPrompt.mode === 'queue',
    'compression runs in a scratch session (got ' + ((compressPrompt || {}).mode || 'none') + ')'
  );
  ok(
    !!compressPrompt && /## 重要锚点/.test(compressPrompt.content[0].text),
    'the scratch session is asked for the resume-ready digest'
  );
  const seedPrompt = e2e.prompt.find((p) => p.sessionId === 'session-inherit-child');
  ok(!!seedPrompt && /dsh-branch-tree:seed/.test(seedPrompt.content[0].text), 'the child receives the digest as its seed');
  ok(
    seedPrompt &&
      seedPrompt.content[0].text.indexOf('旧事件 1') >= 0 &&
      seedPrompt.content[0].text.indexOf('已就绪') >= 0,
    'the seed carries the whole master and asks for a one-line ack'
  );
  ok(
    !/旧事件 3\n【用户】旧事件 3/.test(seedPrompt.content[0].text),
    'the seed does not double events reloaded by loadOlder'
  );
  ok(e2eEntry.digestSource === 'mechanical', 'a missing model answer falls back to the mechanical digest');
  ok(typeof e2eEntry.digestChars === 'number' && e2eEntry.digestChars > 0, 'stored entry records the digest size');
  ok(
    debug.loadStore().branches.length === 1 && debug.loadStore().branches[0].inheritMode === 'inherit',
    'the branch is persisted with its compressed mode'
  );
}

// When the model does answer with a proper digest, the seed must carry that
// digest (not the mechanical transcript) and the entry must say "model".
{
  const { session: mSession, source: mSource } = makeInheritSource();
  const m = { prompt: [] };
  const modelSessions = {
    retain() {
      return {
        ready: Promise.resolve(),
        binding: {
          session: Object.assign({}, mSession, { loadOlder: mSession.loadOlder, rename() {} }),
          eventSource: mSource,
        },
        release() {},
      };
    },
    async fork() {
      return 'session-model-child';
    },
    async create() {
      return 'session-model-scratch';
    },
    async prompt(options) {
      m.prompt.push(options);
      return { accepted: true };
    },
    async wait() {
      mSource.value.entries.push({
        type: 'event',
        event: {
          type: 'assistant/message',
          seq: 32,
          data: { content: [{ type: 'text', text: '## 任务目标\n做分叉插件，分支继承压缩记忆并独立续跑。\n这一段模拟模型真正写出的压缩记忆：它把主会话的目标、约束与已完成项压成要点，交棒给分支继续跑，而不是把原始对话整段搬过去。分支只读这一份摘要就要能直接开工，因此摘要里必须写清楚输出目录约定、命名规则与当前进度，并且明确指出哪些事还没做。\n## 重要锚点\n制图/<master>/<branch> 输出目录约定。' }] },
        },
      });
      return { ok: true };
    },
  };
  const modelCtx = {
    get(name) {
      if (name === 'sessions') return modelSessions;
      if (name === 'uiWorkspace') return { async createDirectory(p, n) { return p + '/' + n; }, openSession() {} };
      if (name === 'workspaces') return { rename: async () => {} };
      return undefined;
    },
  };
  debug.resetStore();
  const modelEntry = await debug.createBranch(
    modelCtx,
    { id: MASTER, title: '制图小助手' },
    '模型摘要分支',
    { workspaces: extracted.workspaces, sessions: extracted.sessions },
    { inheritMode: 'inherit' }
  );
  const modelSeed = m.prompt.find((p) => p.sessionId === 'session-model-child');
  ok(modelEntry.digestSource === 'model', 'a proper model answer is used as the digest (got ' + modelEntry.digestSource + ')');
  ok(!!modelSeed && modelSeed.content[0].text.indexOf('做分叉插件，分支继承压缩记忆') >= 0, 'the seed carries the model digest');
  ok(!!modelSeed && modelSeed.content[0].text.indexOf('旧事件 1') < 0, 'the model digest replaces the raw transcript');
}

// The old "opening only" mode must still fork at the end of turn 1.
{
  const { session: oldSession, source: oldSource } = makeInheritSource();
  const oldCalls = { fork: [] };
  const oldSessions = {
    retain() {
      return {
        ready: Promise.resolve(),
        binding: {
          session: Object.assign({}, oldSession, { rename: async () => {} }),
          eventSource: oldSource,
        },
        release() {},
      };
    },
    async fork(opts) {
      oldCalls.fork.push(opts);
      return 'session-opening-child';
    },
    async prompt() {
      throw new Error('opening mode must not compress');
    },
  };
  const oldCtx = {
    get(name) {
      if (name === 'sessions') return oldSessions;
      if (name === 'uiWorkspace') return { async createDirectory(p, n) { return p + '/' + n; }, openSession() {} };
      if (name === 'workspaces') return { rename: async () => {} };
      return undefined;
    },
  };
  debug.resetStore();
  const oldEntry = await debug.createBranch(
    oldCtx,
    { id: MASTER, title: '制图小助手' },
    '只继承开头',
    { workspaces: extracted.workspaces, sessions: extracted.sessions },
    { inheritMode: 'opening' }
  );
  ok(oldCalls.fork.length === 1 && oldCalls.fork[0].atSeq === 22, 'opening mode still cuts at the end of the first turn (got ' + oldCalls.fork[0].atSeq + ')');
  ok(oldEntry.inheritMode === 'opening', 'opening mode records itself on the entry');
}
console.log(log.join('\n'));
console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE OK (' + log.length + ' checks)');
