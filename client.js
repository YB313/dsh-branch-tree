/**
 * Branch Tree — fork one conversation into independent branches that share the
 * master session's requirements, and browse them as a real tree in the left
 * workspace column.
 *
 * Everything happens on the Client: `sessions.fork` copies the master log up to
 * the boundary we choose (end of the master's FIRST turn), so every branch sees
 * the same requirement message + md references and none of the later drawing
 * chatter. The md files themselves are never copied, so edits to the master's
 * requirements reach every branch on its next read.
 *
 * v3: the plugin replaces `sidebar.workspaces` with its own browser, because the
 * shipped browser has no seat for child rows. A master session becomes a folder
 * row and its branches hang underneath as indented, collapsible children. The
 * main "branch tree" panel stays as a management view.
 */
window.__ModuleLoader__.load({
  id: 'dsh-branch-tree',
  factory(require) {
    const React = require('react');
    const { IconFolderOpenRegular, IconFolderCloseRegular, writeClipboard } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback } = React;

    const STORE_KEY = 'dsh.branch-tree.v1';
    const PANEL_KEY = 'branch-tree';
    const OUTPUT_ROOT = '制图';
    const SOURCE = 'branch-tree';
    // 'on' draws the tree in the shipped sidebar seat; 'off' (set automatically
    // when that seat throws) leaves the shipped session list alone.
    const TAKEOVER_KEY = 'dsh.branch-tree.takeover';
    const COLLAPSE_KEY = 'dsh.branch-tree.collapsed.v1';
    // The tree owns the sidebar entry point to sessions, so a click is itself a
    // trustworthy "this is the conversation I am looking at" signal. It is kept
    // in storage because the host hooks do not reliably expose an active id.
    const ACTIVE_KEY = 'dsh.branch-tree.active.v1';
    const TASK_STATUS_KEY = 'dsh.branch-tree.task-status.v1';
    const SHOW_BRANCH_COUNTS_KEY = 'dsh.branch-tree.show-branch-counts.v1';
    const SESSION_ID_RE = /^session-[0-9a-zA-Z-]{6,}$/;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // ---------------------------------------------------------------- locale
    const EXTRA = {
      zh: {
        nested: '已移入该文件夹',
        moved: '已移到该工作区',
        nestBlocked: '不能移到自己或自己的子项里',
        moveFailed: '移动失败',
        dragHint: '拖到文件夹上即归入其下，拖到工作区标题即整体移过去',
        bindFolder: '设为子工作区（建目录）',
        bindOk: '子工作区已建',
        bindExists: '已经是子工作区',
        bindUnavailable: '宿主没有开放 workspaces.create，无法建子工作区',
        bindFailed: '建子工作区失败：',
        taskRunning: '任务进行中',
        taskUnread: '任务已完成，尚未查看',
        branchCounts: '显示分支数',
        untitledSession: '会话 ',
        digestModel: '模型摘要',
        digestMechanical: '机械摘要',
        charsUnit: ' 字',
        wsRenamed: '工作区已重命名',
        wsRenameUnavailable: '工作区重命名服务不可用',
        wsRenameFailed: '重命名失败：',
        allChats: '全部对话',
        noChats: '暂无对话',
      },
      en: {
        nested: 'Moved under that folder',
        moved: 'Moved to that workspace',
        nestBlocked: 'Cannot nest a node inside itself or its children',
        moveFailed: 'Move failed',
        dragHint: 'Drop on a folder to nest, on a workspace title to move',
        bindFolder: 'Make sub-workspace (real folder)',
        bindOk: 'Sub-workspace created',
        bindExists: 'Already a sub-workspace',
        bindUnavailable: 'workspaces.create is not exposed by the host',
        bindFailed: 'Could not create the sub-workspace: ',
        taskRunning: 'Task in progress',
        taskUnread: 'Task completed, unread',
        branchCounts: 'Show branch counts',
        untitledSession: 'Session ',
        digestModel: 'model digest',
        digestMechanical: 'mechanical digest',
        charsUnit: ' chars',
        wsRenamed: 'Workspace renamed',
        wsRenameUnavailable: 'Workspace rename service unavailable',
        wsRenameFailed: 'Rename failed: ',
        allChats: 'All conversations',
        noChats: 'No conversations yet',
      },
    };
    const DICT = {
      zh: {
        panelLabel: '分支树',
        title: '分支树',
        subtitle:
          '母会话是文件夹，分支是挂在下面的子项。继承方式三种：全景继承（原样复制母会话到此为止的全部对话）、压缩继承（压成一份摘要带过去，分支独立续跑）、开头继承（只带第一条需求）。md 参考共享，母会话改了 md，分支下次读取即生效。',
        addToSession: '＋ 派生分支…',
        namePlaceholder: '分支名称，例如 熊的演化',
        create: '创建',
        creating: '创建中…',
        cancel: '取消',
        needName: '先给分支起个名字。',
        created: '已创建分支',
        open: '打开',
        rename: '重命名',
        archive: '归档',
        archiveWs: '归档此工作区（需确认）',
        unarchiveWs: '取消归档此工作区',
        unarchiveWsConfirm: '把这个工作区里所有被归档的会话取消归档？',
        wsUnarchived: '已取消归档',
        archiveWsConfirm: '把这个工作区的所有会话归档并隐藏这个分组？',
        archived: '已归档',
        archivedHeader: '已归档',
        restoreHint: '点击打开；点右侧箭头还原到树里',
        agoJust: '刚刚',
        agoMin: '分钟前',
        agoHour: '小时前',
        agoDay: '天前',
        unarchive: '取消归档',
        unarchived: '已取消归档',
        archiveFailed: '归档失败',
        wsArchived: '工作区已归档并隐藏',
        wsRestored: '已恢复隐藏的工作区',
        restoreWs: '恢复隐藏的工作区',
        unlink: '移出分支树',
        search: '搜索会话…',
        newSession: '新会话',
        openFolder: '打开文件夹…',
        workspaces: '工作区',
        expand: '展开',
        collapse: '收起',
        empty: '还没有会话。',
        diag: '诊断',
        diagHint: '插件没能从宿主快照里读出会话。请把下面这段复制发给助手。',
        panelHint: '这里与左侧工作区是同一棵树。',
        addChild: '＋ 子分支…',
        copyShape: '复制快照结构',
        dirPending: '（该目录未预建，分支首次写文件时会自己建）',
        restore: '恢复原生左栏',
        takeoverOn: '接管左栏（实验）',
        takeoverOff: '恢复原生左栏',
        modeLabel: '继承方式',
        modeFull: '全景继承',
        modeFullHint: '原样复制母会话到此为止的全部对话，分支接着往下干（默认）',
        modeOpening: '开头继承',
        modeOpeningHint: '只继承母会话第一条需求，看不到后续对话（旧行为）',
        modeInherit: '压缩继承',
        modeInheritHint: '把母会话到此为止的全部记忆压成摘要带过去，分支独立续跑',
        compressing: '正在压缩母会话记忆…',
        compressTimeout: '压缩超时：模型没在时限内写出摘要，已改用机械摘要。',
        compressFallback: '压缩失败，已改用机械摘要：',
        inherited: '已继承压缩记忆',
        emptyFork: '⚠ 分支没能继承到母会话内容（宿主只复制了 0 条事件）。',
        inheritFrom: '继承自',
        seamNote: '以下是本会话分支点之前的压缩记忆，分支从此处独立续跑。',
        nodesc: '（无描述）',
      },
      en: {
        panelLabel: 'Branches',
        title: 'Branches',
        subtitle:
          'A master session is a folder; its branches hang underneath. Three ways to inherit: full copy (the master up to now, verbatim), summary (one digest, then the branch runs on its own), opening only (just the first request). md files stay shared: edit them in the master and the branch sees the new version on its next read.',
        addToSession: '＋ New branch…',
        namePlaceholder: 'Branch name, e.g. bear evolution',
        create: 'Create',
        creating: 'Creating…',
        cancel: 'Cancel',
        needName: 'Name the branch first.',
        created: 'Branch created',
        open: 'Open',
        rename: 'Rename',
        archive: 'Archive',
        archiveWs: 'Archive this workspace (asks first)',
        unarchiveWs: 'Unarchive this workspace',
        unarchiveWsConfirm: 'Unarchive every archived session in this workspace?',
        wsUnarchived: 'Unarchived',
        archiveWsConfirm: 'Archive every session in this workspace and hide the group?',
        archived: 'Archived',
        archivedHeader: 'Archived',
        restoreHint: 'Click to open; the arrow puts it back in the tree',
        agoJust: 'just now',
        agoMin: 'm ago',
        agoHour: 'h ago',
        agoDay: 'd ago',
        unarchive: 'Unarchive',
        unarchived: 'Unarchived',
        archiveFailed: 'Archive failed',
        wsArchived: 'Workspace archived and hidden',
        wsRestored: 'Hidden workspaces restored',
        restoreWs: 'Restore hidden workspaces',
        unlink: 'Remove from tree',
        search: 'Search sessions…',
        newSession: 'New session',
        openFolder: 'Open folder…',
        workspaces: 'Workspaces',
        expand: 'Expand',
        collapse: 'Collapse',
        empty: 'No sessions yet.',
        diag: 'Diagnostics',
        diagHint: 'The plugin could not read sessions from the host snapshot. Copy this and send it to the assistant.',
        panelHint: 'The same tree as the left workspace column.',
        addChild: '＋ Sub-branch…',
        copyShape: 'Copy snapshot shape',
        dirPending: '(folder not pre-created; the branch will make it on first write)',
        restore: 'Restore the native sidebar',
        takeoverOn: 'Draw the tree in the sidebar (beta)',
        takeoverOff: 'Restore the native sidebar',
        modeLabel: 'Inherit',
        modeFull: 'Full copy',
        modeFullHint: 'Copy the whole conversation up to here, verbatim; the branch carries on from it (default)',
        modeOpening: 'Opening only',
        modeOpeningHint: 'Inherit just the first requirement; later chatter stays private (old behaviour)',
        modeInherit: 'Summary',
        modeInheritHint: 'Compress all of the master up to this point and carry it over; the branch then runs alone',
        compressing: 'Compressing the master memory…',
        compressTimeout: 'Compression timed out; fell back to a mechanical digest.',
        compressFallback: 'Compression failed, fell back to a mechanical digest: ',
        inherited: 'Inherited compressed memory',
        emptyFork: 'Warning: the branch inherited nothing — the host copied zero events.',
        inheritFrom: 'Inherited from',
        seamNote: 'Compressed memory of this session before the branch point. The branch runs on from here.',
        nodesc: '(no description)',
      },
    };
    function lang() {
      const normalize = function (value) {
        if (typeof value !== 'string') return '';
        const code = value.trim().toLowerCase();
        if (/^zh(?:[-_]|$)/.test(code)) return 'zh';
        if (/^en(?:[-_]|$)/.test(code)) return 'en';
        return '';
      };
      try {
        const docLang = document && document.documentElement && document.documentElement.lang;
        const active = normalize(docLang);
        if (active) return active;
      } catch (e) {}
      try {
        const storage = (window && window.localStorage) || null;
        if (storage) {
          for (let i = 0; i < storage.length; i += 1) {
            const key = String(storage.key(i) || '');
            if (!/(?:locale|language|lang|i18n)/i.test(key)) continue;
            const raw = storage.getItem(key);
            const direct = normalize(raw);
            if (direct) return direct;
            try {
              const parsed = JSON.parse(raw);
              const nested = parsed && (parsed.language || parsed.locale || parsed.lang);
              const stored = normalize(nested);
              if (stored) return stored;
            } catch (e) {}
          }
        }
      } catch (e) {}
      try {
        const l = (navigator.languages && navigator.languages[0]) || navigator.language || 'zh';
        return normalize(String(l)) || 'zh';
      } catch (e) {
        return 'zh';
      }
    }
    function takeoverState() {
      const v = readJSON(TAKEOVER_KEY, null);
      if (!v) return { mode: 'on' };
      // v6 wrote the bare string 'off' when the seat crashed; treat that legacy
      // value as an automatic shutdown, so a fixed build gets one more attempt.
      if (typeof v === 'string') return { mode: v === 'off' ? 'auto-off' : 'on' };
      return v;
    }
    // An automatic shutdown only holds for the build that failed: a newer build
    // gets one more chance, while a manual "off" stays off until the user turns
    // it back on from the panel footer.
    function takeoverEnabled() {
      const st = takeoverState();
      if (st.mode === 'off') return false;
      if (st.mode === 'auto-off') return st.version !== VERSION;
      return true;
    }
    function L(key) {
      const name = lang();
      const d = DICT[name] || DICT.zh;
      const extra = EXTRA[name] || EXTRA.zh;
      if (d[key] != null) return d[key];
      if (extra && extra[key] != null) return extra[key];
      if (DICT.zh[key] != null) return DICT.zh[key];
      if (EXTRA.zh[key] != null) return EXTRA.zh[key];
      return key;
    }

    // ----------------------------------------------------------------- color
    const COLOR = 'var(--dsw-alias-label-primary, inherit)';
    const MUTED = 'var(--dsw-alias-label-secondary, #6b7280)';
    const BORDER = 'var(--dsw-alias-border-l1, rgba(0,0,0,.10))';
    const BORDER_2 = 'var(--dsw-alias-border-l2, rgba(0,0,0,.16))';
    const BRAND = 'var(--dsw-alias-brand-primary, #247bbf)';
    const LAYER_1 = 'var(--dsw-alias-bg-layer-1, #fff)';
    const LAYER_2 = 'var(--dsw-alias-bg-layer-2, #f4f5f7)';
    const SIDEBAR_FILL = 'var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, #fff))';
    const HOVER = 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.04))';
    const WARN = 'var(--dsw-alias-state-warn-primary, #b45309)';

    // ------------------------------------------------------------------ store
    const listeners = new Set();
    let cache = null;
    function loadStore() {
      if (cache) return cache;
      let raw = null;
      try {
        raw = window.localStorage.getItem(STORE_KEY);
      } catch (e) {}
      let parsed = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch (e) {}
      }
      if (!parsed || typeof parsed !== 'object') parsed = {};
      cache = {
        masters: Array.isArray(parsed.masters) ? parsed.masters : [],
        branches: Array.isArray(parsed.branches) ? parsed.branches : [],
        folders: parsed.folders && typeof parsed.folders === 'object' ? parsed.folders : {},
        hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
        archived: Array.isArray(parsed.archived) ? parsed.archived : [],
        archiveBox: parsed.archiveBox && typeof parsed.archiveBox === 'object' ? parsed.archiveBox : {},
      };
      return cache;
    }
    // v19: the archive box keeps a light snapshot of every archived row, because
    // the host drops archived sessions out of the sidebar snapshot entirely and
    // a name/date is all we need to list them again.
    // v19: a host-side archive can arrive without our own snapshot, so keep
    // whatever we already knew and never blank a stored title.
    function archiveBoxPut(entry) {
      if (!entry || !entry.id) return;
      const s = loadStore();
      const box = Object.assign({}, s.archiveBox);
      const prev = box[entry.id] || {};
      box[entry.id] = Object.assign({}, prev, entry, {
        title: entry.title || prev.title || '',
        dir: entry.dir || prev.dir || '',
        at: entry.at || prev.at || Date.now(),
      });
      patchStore({ archiveBox: box });
    }
    function archiveBoxDrop(id) {
      const s = loadStore();
      if (!s.archiveBox[id]) return;
      const box = Object.assign({}, s.archiveBox);
      delete box[id];
      patchStore({ archiveBox: box });
    }
    // Any partial write must keep the tables it does not mention: rebuilding the
    // object from two keys used to wipe `folders` and `hidden`.
    function patchStore(patch) {
      const cur = loadStore();
      saveStore(Object.assign({}, cur, patch));
      return cache;
    }
    function isArchived(id) {
      return loadStore().archived.indexOf(id) >= 0;
    }
    // v19: keep a light snapshot before the host drops the row from the sidebar
    // snapshot, otherwise the archive section has nothing to list.
    function markArchived(id, snap) {
      const s = loadStore();
      const next = s.archived.indexOf(id) < 0 ? s.archived.concat([id]) : s.archived;
      const box = Object.assign({}, s.archiveBox);
      const prev = box[id] || {};
      box[id] = {
        id: id,
        title: (snap && snap.title) || prev.title || '',
        dir: (snap && snap.dir) || prev.dir || '',
        group: (snap && snap.group) || prev.group || '',
        at: (snap && snap.at) || Date.now(),
      };
      patchStore({ archived: next, archiveBox: box });
    }
    function unmarkArchived(id) {
      const s = loadStore();
      archiveBoxDrop(id);
      patchStore({
        archived: s.archived.filter(function (x) {
          return x !== id;
        }),
      });
    }
    function subtreeIds(store, id) {
      const out = [id];
      const seen = {};
      seen[id] = true;
      for (let i = 0; i < out.length; i += 1) {
        store.branches.forEach(function (b) {
          if (b.parentId === out[i] && !seen[b.branchId]) {
            seen[b.branchId] = true;
            out.push(b.branchId);
          }
        });
      }
      return out;
    }

    // Removing a node from the tree: drop its entry and its folder binding.
    function unstow(id) {
      const s = loadStore();
      const folders = Object.assign({}, s.folders);
      delete folders[id];
      return patchStore({
        branches: s.branches.filter(function (b) {
          return b.branchId !== id;
        }),
        folders: folders,
      });
    }
    function saveStore(next) {
      // Every reader assumes all four tables exist.
      next.masters = Array.isArray(next.masters) ? next.masters : [];
      next.branches = Array.isArray(next.branches) ? next.branches : [];
      next.folders = next.folders && typeof next.folders === 'object' ? next.folders : {};
      next.hidden = Array.isArray(next.hidden) ? next.hidden : [];
      next.archived = Array.isArray(next.archived) ? next.archived : [];
      next.archiveBox = next.archiveBox && typeof next.archiveBox === 'object' ? next.archiveBox : {};
      cache = next;
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch (e) {}
      emit();
    }
    function resetStore() {
      cache = { masters: [], branches: [], folders: {}, hidden: [], archived: [], archiveBox: {} };
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(cache));
      } catch (e) {}
      emit();
    }
    function emit() {
      listeners.forEach(function (fn) {
        try {
          fn();
        } catch (e) {}
      });
    }
    function useVersion() {
      const pair = useState(0);
      const set = pair[1];
      useEffect(function () {
        const fn = function () {
          set(function (n) {
            return n + 1;
          });
        };
        listeners.add(fn);
        return function () {
          listeners.delete(fn);
        };
      }, []);
      return pair[0];
    }
    // A Zotero-style forest: a master session is a folder, and a branch may
    // hold branches of its own (`parentId`), so nesting has no fixed depth.
    function groupsOf(store) {
      const nodes = new Map();
      const ensure = function (id, title) {
        if (!nodes.has(id)) {
          nodes.set(id, { id: id, title: title || id, children: [], isBranch: false });
        }
        const n = nodes.get(id);
        if (title) n.title = title;
        return n;
      };
      (store.masters || []).forEach(function (m) {
        ensure(m.id, m.title);
      });
      const branches = (store.branches || []).filter(function (b) {
        return b && b.branchId;
      });
      branches.forEach(function (b) {
        const n = ensure(b.branchId, b.name || b.branchId);
        n.isBranch = true;
        n.name = b.name || n.title;
        n.dir = b.dir;
        n.masterId = b.masterId;
        n.masterTitle = b.masterTitle || b.name;
        n.parentId = b.parentId || b.masterId;
      });
      const roots = [];
      const seen = new Set();
      branches.forEach(function (b) {
        const n = nodes.get(b.branchId);
        let parent = nodes.get(n.parentId);
        if (!parent || parent === n) parent = nodes.get(b.masterId);
        if (!parent || parent === n) {
          if (!seen.has(n.id)) {
            seen.add(n.id);
            roots.push(n);
          }
          return;
        }
        if (parent.children.indexOf(n) < 0) parent.children.push(n);
      });
      (store.masters || []).forEach(function (m) {
        const n = nodes.get(m.id);
        if (n && !seen.has(n.id)) {
          seen.add(n.id);
          roots.push(n);
        }
      });
      return { roots: roots, byId: nodes };
    }
    function activityTime(value) {
      if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
      if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
      const text = value == null ? '' : String(value).trim();
      if (!text) return 0;
      if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text) || 0;
      const parsed = Date.parse(text);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    function latestTimestamp(a, b) {
      if (a == null) return b;
      if (b == null) return a;
      return activityTime(b) > activityTime(a) ? b : a;
    }
    // Sort siblings by the newest visible activity in their recursive subtree.
    // Keep ties in the original order so legacy branch ordering stays stable.
    function sortBySubtreeActivity(ids, nodeById, sessions, extraChildren, isVisible, rankCache) {
      const ranks = rankCache || new Map();
      const visiting = new Set();
      const visible = typeof isVisible === 'function' ? isVisible : function () { return true; };
      const ownTime = function (id) {
        const record = sessions && typeof sessions.get === 'function' ? sessions.get(id) : null;
        if (!record) return 0;
        return Math.max(
          activityTime(record.updatedAt),
          activityTime(record.updated),
          activityTime(record.lastActivityAt)
        );
      };
      const rank = function (id) {
        if (!id || !visible(id)) return 0;
        if (ranks.has(id)) return ranks.get(id);
        const own = ownTime(id);
        if (visiting.has(id)) return own;
        visiting.add(id);
        const node = nodeById && typeof nodeById.get === 'function' ? nodeById.get(id) : null;
        const childIds = (node && Array.isArray(node.children) ? node.children : []).map(function (child) {
          return child && child.id;
        });
        if (typeof extraChildren === 'function') {
          const extra = extraChildren(id) || [];
          extra.forEach(function (childId) { childIds.push(childId); });
        }
        let latest = own;
        const seen = new Set();
        childIds.forEach(function (childId) {
          if (!childId || childId === id || seen.has(childId)) return;
          seen.add(childId);
          latest = Math.max(latest, rank(childId));
        });
        visiting.delete(id);
        ranks.set(id, latest);
        return latest;
      };
      return (ids || []).map(function (id, index) {
        return { id: id, index: index, activity: rank(id) };
      }).sort(function (a, b) {
        return b.activity - a.activity || a.index - b.index;
      }).map(function (entry) { return entry.id; });
    }

    // Drag-and-drop reparenting. Any session row can be dragged onto a folder
    // row (a master session, or a branch) and adopted as its child; dragged onto
    // a workspace header it moves into that workspace. Both are pure store
    // mutations, so the smoke test can drive them without React.
    function entryOf(store, id) {
      const list = (store && store.branches) || [];
      for (let i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].branchId === id) return list[i];
      }
      return undefined;
    }
    // A folder node can own a real directory and a workspace rooted there, so
    // anything started inside it runs with that directory as its cwd.
    function folderOf(store, id) {
      const all = (store && store.folders) || {};
      const got = all[id];
      return got && typeof got === 'object' ? got : undefined;
    }
    function setFolder(store, id, patch) {
      if (!store.folders || typeof store.folders !== 'object') store.folders = {};
      store.folders[id] = Object.assign({}, store.folders[id], patch);
      return store.folders[id];
    }
    function childDir(parentDir, name) {
      const safe = sanitizeName(name) || 'sub';
      if (!parentDir) return safe;
      return String(parentDir).replace(/\/+$/, '') + '/' + safe;
    }
    function boundWorkspaceIds(store) {
      const set = new Set();
      const all = (store && store.folders) || {};
      Object.keys(all).forEach(function (k) {
        const got = all[k];
        if (got && got.ws) set.add(got.ws);
      });
      return set;
    }
    function isDescendant(store, ancestorId, nodeId) {
      let cur = nodeId;
      for (let i = 0; i < 64; i += 1) {
        const e = entryOf(store, cur);
        if (!e) return false;
        const next = e.parentId || e.masterId;
        if (!next || next === cur) return false;
        if (next === ancestorId) return true;
        cur = next;
      }
      return false;
    }
    function canNest(store, dragId, targetId) {
      if (!dragId || !targetId || dragId === targetId) return false;
      return !isDescendant(store, dragId, targetId);
    }
    function nestUnder(store, dragId, targetId, titleById) {
      if (!canNest(store, dragId, targetId)) return false;
      const nameOf = typeof titleById === 'function' ? titleById : function (x) { return x; };
      const target = entryOf(store, targetId);
      const targetTitle = (target && target.name) || nameOf(targetId) || targetId;
      let entry = entryOf(store, dragId);
      if (!entry) {
        if (!Array.isArray(store.branches)) store.branches = [];
        entry = {
          branchId: dragId,
          name: nameOf(dragId) || dragId,
          dir: null,
          createdAt: Date.now(),
          adopted: true,
        };
        store.branches.push(entry);
      }
      entry.parentId = targetId;
      if (target) {
        entry.masterId = target.masterId || (target.parentId || targetId);
        entry.masterTitle = target.masterTitle || targetTitle;
      } else {
        entry.masterId = targetId;
        entry.masterTitle = targetTitle;
      }
      if (!Array.isArray(store.masters)) store.masters = [];
      const known = store.masters.some(function (m) {
        return m && m.id === targetId;
      });
      if (!known) store.masters.push({ id: targetId, title: targetTitle });
      return true;
    }
    function detachEntry(store, id) {
      const list = (store && store.branches) || [];
      const i = list.findIndex(function (b) {
        return b && b.branchId === id;
      });
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    }
    function readJSON(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        const v = JSON.parse(raw);
        return v == null ? fallback : v;
      } catch (e) {
        return fallback;
      }
    }
    function writeJSON(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    }
    function normalizeTaskStatuses(value) {
      const result = {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
      Object.keys(value).forEach(function (rawId) {
        const id = normId(rawId);
        const status = value[rawId];
        if (isSessionId(id) && (status === 'running' || status === 'unread')) result[id] = status;
      });
      return result;
    }
    function reconcileTaskStatuses(previous, sessions) {
      const next = normalizeTaskStatuses(previous);
      const entries =
        sessions instanceof Map
          ? Array.from(sessions.entries())
          : sessions && typeof sessions === 'object'
            ? Object.keys(sessions).map(function (id) { return [id, sessions[id]]; })
            : [];
      entries.forEach(function (entry) {
        const id = normId(entry[0]);
        const session = entry[1] || {};
        if (!isSessionId(id)) return;
        if (session.running) next[id] = 'running';
        else if (next[id] === 'running') next[id] = 'unread';
        else if (next[id] !== 'unread') delete next[id];
      });
      return next;
    }
    function acknowledgeTaskStatus(previous, rawId) {
      const next = normalizeTaskStatuses(previous);
      const id = normId(rawId);
      if (next[id] === 'unread') delete next[id];
      return next;
    }
    function taskStatusesEqual(a, b) {
      const left = normalizeTaskStatuses(a);
      const right = normalizeTaskStatuses(b);
      const keys = Object.keys(left);
      if (keys.length !== Object.keys(right).length) return false;
      return keys.every(function (id) { return left[id] === right[id]; });
    }

    // ------------------------------------------------------------------ utils
    function sanitizeName(name) {
      return String(name || '')
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+/, '')
        .slice(0, 60);
    }
    function wait(ms) {
      return new Promise(function (r) {
        setTimeout(r, ms);
      });
    }
    function service(ctx, name) {
      try {
        return ctx.get(name);
      } catch (e) {
        return undefined;
      }
    }
    function isSessionId(v) {
      return typeof v === 'string' && (SESSION_ID_RE.test(v) || UUID_RE.test(v));
    }
    // Session maps are keyed by a bare uuid in some snapshots and by the
    // session-prefixed uuid in others; the sidebar always uses the prefixed
    // form, so every id is normalised to that shape before it is stored or read.
    function normId(v) {
      if (typeof v !== 'string') return v;
      return UUID_RE.test(v) ? 'session-' + v : v;
    }
    function lastSeg(path) {
      if (typeof path !== 'string') return '';
      const parts = path.split(/[\\/]/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : path;
    }

    // ------------------------------------------------------------- titles
    // Titles do not live where the docs imply: the workspace snapshot keeps
    // them inside projection records (`{record:{rows:{title:{val}}}}`) or in a
    // plain id -> title map, and SessionSnapshot itself has no title field.
    // Rather than guess one shape, unwrap every shape we know of.
    function unwrapTitle(v, depth) {
      if (typeof v === 'string') return v.trim();
      if (!v || typeof v !== 'object' || (depth || 0) > 3) return '';
      const keys = ['val', 'value', 'current', 'text', 'title', 'name', 'displayTitle'];
      for (let i = 0; i < keys.length; i += 1) {
        const got = unwrapTitle(v[keys[i]], (depth || 0) + 1);
        if (got) return got;
      }
      return '';
    }
    function plausibleTitle(v) {
      const t = unwrapTitle(v, 0);
      if (!t || t.length > 120) return '';
      if (isSessionId(t)) return '';
      return t;
    }
    function pickTitle(node, depth) {
      if (!node || typeof node !== 'object' || depth > 4) return '';
      const direct = ['title', 'displayTitle', 'name', 'label'];
      for (let i = 0; i < direct.length; i += 1) {
        const got = plausibleTitle(node[direct[i]]);
        if (got) return got;
      }
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i += 1) {
        const child = node[keys[i]];
        if (child && typeof child === 'object') {
          const got = pickTitle(child, depth + 1);
          if (got) return got;
        }
      }
      return '';
    }
    function sessionLabel(id) {
      return L('untitledSession') + String(id || '').slice(-6);
    }
    // v19: a compact age for archive rows; the exact date lives in the tooltip.
    function agoText(at) {
      if (!at) return '';
      const ms = Date.now() - at;
      if (!(ms > 0)) return L('agoJust');
      const min = Math.floor(ms / 60000);
      if (min < 1) return L('agoJust');
      if (min < 60) return min + L('agoMin');
      const hr = Math.floor(min / 60);
      if (hr < 24) return hr + L('agoHour');
      return Math.floor(hr / 24) + L('agoDay');
    }
    // A compact sketch of a snapshot, for the "copy snapshot" diagnostic: type
    // per key, two levels deep, so one paste is enough to calibrate the reader.
    function propKeysOf(props) {
      try {
        return Object.keys(props || {})
          .filter(function (k) {
            return /^use[A-Z]/.test(k) || k === 'wide' || k === 'expandSidebar';
          })
          .join(', ');
      } catch (e) {
        return '';
      }
    }
    function shapeOf(v, depth) {
      if (v == null) return 'null';
      if (depth > 2) return typeof v;
      if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1)] : [];
      if (typeof v === 'object') {
        const out = {};
        Object.keys(v)
          .slice(0, 40)
          .forEach(function (k) {
            out[k] = shapeOf(v[k], depth + 1);
          });
        return out;
      }
      return typeof v;
    }

    function collectPaths(node, depth, out, seen) {
      if (!node || typeof node !== 'object' || depth > 5) return out;
      if (seen.has(node)) return out;
      seen.add(node);
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i += 1) collectPaths(node[i], depth + 1, out, seen);
        return out;
      }
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        const v = node[k];
        if (
          (k === 'path' || k === 'cwd' || k === 'directory' || k === 'root') &&
          typeof v === 'string' &&
          v.charAt(0) === '/'
        ) {
          if (out.indexOf(v) < 0) out.push(v);
        } else if (v && typeof v === 'object') {
          collectPaths(v, depth + 1, out, seen);
        }
      }
      return out;
    }

    // ------------------------------------------------- snapshot extraction
    // The shipped WorkspaceSnapshot type is not published with the package, so
    // read it structurally: any object carrying `sessionIds` is a workspace, any
    // object carrying a session id + a title is session metadata.
    function extractSnapshot(snapshot) {
      const workspaces = [];
      const sessions = new Map();
      const archivedIds = new Set();
      const seenWorkspace = new Set();
      const visited = new WeakSet();
      const noteSession = function (id, obj) {
        if (!isSessionId(id)) return;
        id = normId(id);
        const prev = sessions.get(id) || { id: id };
        const next = Object.assign({}, prev);
        if (obj && typeof obj === 'object') {
          const found = pickTitle(obj, 0);
          if (found) next.title = found;
          const activity = latestTimestamp(
            latestTimestamp(obj.updatedAt, obj.updated),
            obj.lastActivityAt
          );
          if (activity != null) next.updatedAt = latestTimestamp(next.updatedAt, activity);
          if (typeof obj.running === 'boolean') next.running = obj.running;
          // The host keeps archived sessions in workspace.sessionIds and does not
          // document a flag, so any archived marker found on the record is kept.
          if (obj.archived === true || obj.archivedAt || obj.archived_at) next.archived = true;
        }
        sessions.set(id, next);
      };
      const walk = function (node, depth, key) {
        // A plain `{ 'session-…': 'title' }` map is a title table, not a node.
        if (isSessionId(key) && typeof node === 'string') {
          noteSession(key, { title: node });
          return;
        }
        if (!node || typeof node !== 'object' || depth > 6) return;
        if (visited.has(node)) return;
        visited.add(node);
        if (Array.isArray(node)) {
          for (let i = 0; i < node.length; i += 1) walk(node[i], depth + 1, undefined);
          return;
        }
        if (isSessionId(key)) noteSession(key, node);
        if (isSessionId(node.sessionId)) noteSession(node.sessionId, node);
        else if (isSessionId(node.id)) noteSession(node.id, node);
        const ids = Array.isArray(node.sessionIds) ? node.sessionIds : null;
        if (ids) {
          const id = node.workspaceId || node.id || node.path || 'ws-' + workspaces.length;
          if (!seenWorkspace.has(id)) {
            seenWorkspace.add(id);
            // The host keeps archived sessions out of the visible list through
            // this per-workspace id list (see workspace storage), so the same
            // marker is mirrored onto the session records for filtering.
            const arch = Array.isArray(node.archivedSessionIds) ? node.archivedSessionIds : null;
            if (arch) {
              arch.forEach(function (raw) {
                if (!isSessionId(raw)) return;
                const nid = normId(raw);
                archivedIds.add(nid);
                const rec = sessions.get(nid) || { id: nid };
                rec.archived = true;
                sessions.set(nid, rec);
              });
            }
            // The host keeps one registry-GLOBAL archive set in the workspace
            // snapshot (workspaceDomainState.archivedSessionIds). It is not a
            // per-workspace list and it sits on the same record that carries the
            // workspace order, so a workspace whose every session was archived
            // still reports the whole set. Mirror every member onto its record.
            const globalArch = Array.isArray(node.archivedSessionIds)
              ? node.archivedSessionIds
              : null;
            if (globalArch) {
              globalArch.forEach(function (raw) {
                if (!isSessionId(raw)) return;
                const nid = normId(raw);
                archivedIds.add(nid);
                const rec = sessions.get(nid) || { id: nid };
                rec.archived = true;
                sessions.set(nid, rec);
              });
            }
            workspaces.push({
              id: id,
              title: typeof node.title === 'string' && node.title ? node.title : lastSeg(node.path) || String(id),
              path: typeof node.path === 'string' ? node.path : undefined,
              sessionIds: ids.map(normId),
            });
          }
          return;
        }
        const keys = Object.keys(node);
        for (let i = 0; i < keys.length; i += 1) {
          const k = keys[i];
          if (k === 'title' || k === 'sessionIds') continue;
          walk(node[k], depth + 1, k);
        }
      };
      walk(snapshot, 0, undefined);
      workspaces.forEach(function (ws) {
        ws.sessionIds.forEach(function (id) {
          if (isSessionId(id) && !sessions.has(id)) sessions.set(id, { id: normId(id) });
        });
      });
      return { workspaces: workspaces, sessions: sessions, archivedIds: archivedIds };
    }

    // v6: the host's selector hooks ARE React hooks, so the number of calls
    // must stay identical on every render of one instance. The host mounts this
    // seat in more than one mode and does not always hand over the same set, so
    // the set is frozen per instance and the instance is keyed by it (hookKey):
    // a changed set mounts a fresh component instead of throwing React #310.
    const HOST_HOOKS = [
      'useWorkspaces',
      'useSessions',
      'useSessionStatus',
      'useSessionRetainInfo',
      'usePanelInfo',
    ];
    // The host hooks are SELECTOR hooks: `useWorkspaces(selector)` forwards to
    // useSyncExternalStoreWithSelector, which throws "selector is not a function"
    // when called bare. v6 called them with no argument, and that is exactly the
    // error the diagnostic panel showed. SELECT_ALL keeps the whole snapshot and
    // lets the structural extractor below do the shaping.
    const SELECT_ALL = function (snapshot) {
      return snapshot;
    };
    function hookKey(props) {
      const p = props || {};
      const have = HOST_HOOKS.filter(function (n) {
        return typeof p[n] === 'function';
      });
      return have.length ? have.join('+') : 'none';
    }
    function useHostData(props) {
      const p = props || {};
      const wsSnap = typeof p.useWorkspaces === 'function' ? p.useWorkspaces(SELECT_ALL) : undefined;
      const sessSnap = typeof p.useSessions === 'function' ? p.useSessions(SELECT_ALL) : undefined;
      const statusSnap =
        typeof p.useSessionStatus === 'function' ? p.useSessionStatus(SELECT_ALL) : undefined;
      const panelSnap = typeof p.usePanelInfo === 'function' ? p.usePanelInfo(SELECT_ALL) : undefined;
      const retainSnap =
        typeof p.useSessionRetainInfo === 'function' ? p.useSessionRetainInfo(SELECT_ALL) : undefined;
      return useMemo(
        function () {
          return mergeHostData(wsSnap, sessSnap, statusSnap, panelSnap, retainSnap);
        },
        [wsSnap, sessSnap, statusSnap, panelSnap, retainSnap]
      );
    }

    function findIdByKey(node, pattern, depth, seen) {
      if (!node || typeof node !== 'object' || depth > 7 || seen.has(node)) return undefined;
      seen.add(node);
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i += 1) {
          const found = findIdByKey(node[i], pattern, depth + 1, seen);
          if (found) return found;
        }
        return undefined;
      }
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (!pattern.test(key)) continue;
        const value = node[key];
        if (isSessionId(value)) return normId(value);
        const nested = findIdByKey(value, /^(?:id|sessionId|session_id|conversationId|conversation_id)$/i, depth + 1, seen);
        if (nested) return nested;
      }
      for (let i = 0; i < keys.length; i += 1) {
        const nested = findIdByKey(node[keys[i]], pattern, depth + 1, seen);
        if (nested) return nested;
      }
      return undefined;
    }
    function findSessionId(node, depth, seen) {
      if (!node || typeof node !== 'object' || depth > 7 || seen.has(node)) return undefined;
      seen.add(node);
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i += 1) {
          const found = findSessionId(node[i], depth + 1, seen);
          if (found) return found;
        }
        return undefined;
      }
      if (isSessionId(node.sessionId)) return normId(node.sessionId);
      if (isSessionId(node.session_id)) return normId(node.session_id);
      if (isSessionId(node.conversationId)) return normId(node.conversationId);
      if (isSessionId(node.conversation_id)) return normId(node.conversation_id);
      if (isSessionId(node.id) && (node.kind === 'session' || node.type === 'session')) return normId(node.id);
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i += 1) {
        const found = findSessionId(node[keys[i]], depth + 1, seen);
        if (found) return found;
      }
      return undefined;
    }
    function findDirectPanelSessionId(node, depth, seen) {
      if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 5 || seen.has(node)) return undefined;
      seen.add(node);
      const directKeys = ['sessionId', 'session_id', 'conversationId', 'conversation_id'];
      for (let i = 0; i < directKeys.length; i += 1) {
        if (isSessionId(node[directKeys[i]])) return normId(node[directKeys[i]]);
      }
      if (/^(?:session|conversation|chat)$/i.test(String(node.kind || node.type || '')) && isSessionId(node.id)) {
        return normId(node.id);
      }
      const contextKeys = ['active', 'current', 'selected', 'panel', 'session', 'conversation', 'chat', 'context'];
      for (let i = 0; i < contextKeys.length; i += 1) {
        const value = node[contextKeys[i]];
        if (!value || typeof value !== 'object') continue;
        const found = findDirectPanelSessionId(value, depth + 1, seen);
        if (found) return found;
      }
      return undefined;
    }
    function findActiveSessionId(snapshots) {
      const explicit = /^(?:(?:active|current|selected)(?:Session|Conversation|Chat)?(?:Id|ID)|(?:session|conversation)(?:Id|ID)?(?:Active|Current|Selected))$/i;
      // Panel info is the only hook scoped to the conversation currently open in
      // the main view. Accept its direct session context, but never guess the
      // first session found in a global sessions/workspaces snapshot.
      const fromPanel = findDirectPanelSessionId(snapshots[0], 0, new WeakSet());
      if (fromPanel) return fromPanel;
      for (let i = 0; i < snapshots.length; i += 1) {
        const found = findIdByKey(snapshots[i], explicit, 0, new WeakSet());
        if (found) return found;
      }
      return undefined;
    }

    // Pure merge of the host snapshots, kept out of the hook so it can be tested
    // without React. Titles live only in the sessions snapshot (byId[id].title).
    function mergeHostData(wsSnap, sessSnap, statusSnap, panelSnap, retainSnap) {
      const a = extractSnapshot(wsSnap);
      const r = extractSnapshot(retainSnap);
      r.sessions.forEach(function (v, k) {
        const prev = a.sessions.get(k) || { id: k };
        const merged = Object.assign({}, v, prev, { title: prev.title || v.title });
        const updatedAt = latestTimestamp(v.updatedAt, prev.updatedAt);
        if (updatedAt != null) merged.updatedAt = updatedAt;
        a.sessions.set(k, merged);
      });
      // Workspaces seed a titleless placeholder per member id, so this merge can
      // never be skipped on the grounds that some session is already known.
      const b = extractSnapshot(sessSnap);
      b.workspaces.forEach(function (w) {
        const known = a.workspaces.some(function (x) {
          return x.id === w.id;
        });
        if (!known) a.workspaces.push(w);
      });
      b.sessions.forEach(function (v, k) {
        const prev = a.sessions.get(k);
        if (!prev) {
          a.sessions.set(k, v);
          return;
        }
        if (!prev.title && v.title) prev.title = v.title;
        const updatedAt = latestTimestamp(prev.updatedAt, v.updatedAt);
        if (updatedAt != null) prev.updatedAt = updatedAt;
        if (prev.running == null && v.running != null) prev.running = v.running;
        if (v.archived && !prev.archived) prev.archived = true;
      });
      if (statusSnap) {
        const c = extractSnapshot(statusSnap);
        c.sessions.forEach(function (v, k) {
          const prev = a.sessions.get(k);
          if (prev && v.running != null) prev.running = v.running;
        });
      }
      const activeId = findActiveSessionId([panelSnap, sessSnap, statusSnap, wsSnap]);
      // Union the host archive sets of every snapshot that actually sees them.
      const archivedIds = new Set(a.archivedIds);
      [r, b, extractSnapshot(statusSnap), extractSnapshot(panelSnap)].forEach(function (part) {
        part.archivedIds.forEach(function (id) {
          archivedIds.add(id);
        });
      });
      return {
        workspaces: a.workspaces,
        sessions: a.sessions,
        archivedIds: archivedIds,
        activeId: activeId,
        paths: collectPaths(wsSnap, 0, [], new WeakSet()).concat(
          collectPaths(sessSnap, 0, [], new WeakSet())
        ),
        raw: {
          workspaces: wsSnap,
          sessions: sessSnap,
          retain: retainSnap,
          status: statusSnap,
          panel: panelSnap,
        },
      };
    }

    // ----------------------------------------------------------- fork helpers
    function eventWindowOf(source) {
      try {
        const v = source && (source.value != null ? source.value : source);
        const w = typeof v === 'function' ? v() : v;
        if (w && Array.isArray(w.entries)) return w;
      } catch (e) {}
      try {
        const cur = source && source.current;
        if (cur && Array.isArray(cur.entries)) return cur;
      } catch (e) {}
      return null;
    }
    function entriesOf(source) {
      return eventWindowOf(source) || { entries: [], hasMore: false };
    }
    function eventsOf(source) {
      return entriesOf(source).entries.map(function (e) {
        return e && e.event;
      });
    }
    // The host's own default fork boundary (SessionCommandController#fork /
    // latestCompletedPrefixBoundary in the DSH build): the last turn/end, then
    // any standalone events written after it until the next turn begins.
    // Reproducing it here matters because the host validates a supplied atSeq
    // with source.events[boundary]?.seq !== boundary — the boundary has to be a
    // real seq in the master log, not an index into a partially loaded page.
    // A fork that copies nothing still "succeeds": the host happily seeds the
    // child with whatever precedes the boundary, and the branch starts empty.
    // Reading the child's inheritedEventCount back is the only cheap way to
    // tell a real copy from an empty shell, so branches are checked right after
    // the fork and retried without an explicit atSeq when they come back empty.
    async function inheritedCountOf(sessions, childId, sourceId) {
      const ref = sessions.retain(childId, { source: SOURCE });
      try {
        await ref.ready;
        const binding = ref && ref.binding;
        const sid = (binding && (binding.sessionId || (binding.session && binding.session.id))) || childId;
        const list = [];
        const visit = function (node) {
          if (!node) return;
          if (typeof node === 'string') return;
          if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i += 1) visit(node[i]);
            return;
          }
          if (typeof node !== 'object') return;
          if (node.sessionId === sid || node.id === sid) list.push(node);
          else if (node.compare && node.compare(sid) === 0) list.push(node);
        };
        try {
          visit(sessions.list());
        } catch (e0) {
        }
        const counts = [];
        for (let i = 0; i < list.length; i += 1) {
          const n = list[i].inheritedEventCount;
          if (typeof n === 'number') counts.push(n);
        }
        const face = binding && binding.session;
        if (!counts.length && face && typeof face.inheritedEventCount === 'number') {
          counts.push(face.inheritedEventCount);
        }
        return counts.length ? Math.max.apply(null, counts) : undefined;
      } catch (e) {
        return undefined;
      } finally {
        releaseRef(ref);
      }
    }
    const EMPTY_FORK_RETRIES = 2;
    function completedTurnBoundary(events) {
      let lastTurnEnd;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i];
        if (ev && ev.type === 'turn/end' && typeof ev.seq === 'number') {
          lastTurnEnd = ev;
          break;
        }
      }
      if (!lastTurnEnd) return undefined;
      let boundary = lastTurnEnd.seq;
      for (let i = 0; i < events.length; i += 1) {
        const ev = events[i];
        if (!ev || typeof ev.seq !== 'number' || ev.seq <= boundary) continue;
        if (
          ev.type === 'turn/start' ||
          ev.type === 'agent/inbox/spliced' ||
          (ev.type === 'user/message' && ev.surfaceOp === 'append')
        ) {
          break;
        }
        boundary = ev.seq;
      }
      return boundary;
    }
    function isConversationEvent(entry) {
      const type = String((entry && entry.event && entry.event.type) || '').toLowerCase();
      return /^(?:user|assistant)[/_-](?:message|final|response)$/.test(type);
    }
    function isUnstartedSessionRef(ref) {
      const binding = (ref && ref.binding) || {};
      const source = (ref && ref.eventSource) || binding.eventSource;
      const win = eventWindowOf(source);
      if (!win) return false;
      if (win.entries.some(isConversationEvent)) return false;
      // If older events are outside this window, fail open rather than hiding a
      // real conversation whose first turn has not been loaded yet.
      return !win.hasMore;
    }
    async function isUnstartedSession(ctx, id) {
      const sessions = service(ctx, 'sessions');
      if (!sessions || typeof sessions.retain !== 'function') return false;
      let ref;
      try {
        ref = sessions.retain(id, { source: SOURCE });
        if (ref && ref.ready && typeof ref.ready.then === 'function') await ref.ready;
        return isUnstartedSessionRef(ref);
      } catch (e) {
        return false;
      } finally {
        releaseRef(ref);
      }
    }
    function userMessageSeq(entry) {
      const ev = entry && entry.event;
      if (!ev) return undefined;
      if (ev.type !== 'user/message' && ev.type !== 'user_message') return undefined;
      // The host logs its own injected blocks as `user/message` too — runtime
      // context, the skill catalog, the time snapshot. Counting those as turns
      // puts the "second user message" one seq after the real one, which drags
      // the boundary back to the START of turn 1 (observed: atSeq 8 on a master
      // whose turn 1 ran 4→19). Forking at a half-finished turn inherits
      // nothing, so the branch arrives with an empty history.
      const kind = (ev.data && ev.data.source && ev.data.source.kind) || (ev.source && ev.source.kind) || '';
      if (kind && kind !== 'user') return undefined;
      return ev.seq;
    }
    // The seq of the first completed turn's `turn/end`. This — not the start of
    // the next user message — is the real end of the master's FIRST turn, and it
    // is the only boundary the host will materialise a full prefix for.
    function firstTurnEndSeq(entries) {
      const ends = entries
        .map(function (e) {
          return e && e.event;
        })
        .filter(function (ev) {
          return ev && ev.type === 'turn/end' && typeof ev.seq === 'number';
        })
        .map(function (ev) {
          return ev.seq;
        })
        .sort(function (a, b) {
          return a - b;
        });
      return ends.length ? ends[0] : undefined;
    }
    // The boundary we fork at is the end of the master's FIRST turn: its
    // `turn/end` seq. Everything after that is the master's own later
    // conversation and must not reach a branch.
    async function readForkBoundary(ref) {
      const binding = (ref && ref.binding) || {};
      const source = (ref && ref.eventSource) || binding.eventSource;
      const win = entriesOf(source);
      let entries = win.entries.slice();
      let guard = 0;
      const session = binding.session;
      // Load older events until we can see the end of turn 1 — either a
      // `turn/end` or a second *real* user message, whichever shows up first.
      const enough = function () {
        return (
          firstTurnEndSeq(entries) !== undefined || entries.filter(userMessageSeq).length >= 2
        );
      };
      while (!enough() && guard < 160 && session && typeof session.loadOlder === 'function') {
        guard += 1;
        const before = entries.length;
        try {
          await session.loadOlder();
        } catch (e) {
          break;
        }
        entries = entriesOf(source).entries.slice();
        if (entries.length === before && guard > 3) break;
        await wait(30);
      }
      const turnEnd = firstTurnEndSeq(entries);
      if (turnEnd !== undefined) return { atSeq: turnEnd, degraded: false };
      // Turn 1 never closed (still streaming, or abandoned): use the newest
      // completed turn so the host has a prefix it will actually copy.
      const open = completedTurnBoundary(eventsOf(source));
      if (open !== undefined) return { atSeq: open, degraded: true };
      const seqs = entries
        .map(userMessageSeq)
        .filter(function (s) {
          return typeof s === 'number';
        })
        .sort(function (a, b) {
          return a - b;
        });
      const maxSeq = entries.reduce(function (m, e) {
        const s = e && e.event && e.event.seq;
        return typeof s === 'number' && s > m ? s : m;
      }, 0);
      if (seqs.length >= 2) {
        const second = seqs[1];
        const below = entries
          .map(function (e) {
            return e && e.event && e.event.seq;
          })
          .filter(function (s) {
            return typeof s === 'number' && s < second;
          });
        return { atSeq: below.length ? Math.max.apply(null, below) : 0, degraded: false };
      }
      return { atSeq: maxSeq, degraded: true };
    }

    async function openSessionSafe(ctx, id, onOpened) {
      const ui = service(ctx, 'uiWorkspace');
      if (!ui || typeof ui.openSession !== 'function') return false;
      let opened = false;
      try {
        await ui.openSession(id);
        opened = true;
      } catch (e) {
        try {
          await ui.openSession({ sessionId: id });
          opened = true;
        } catch (fallbackError) {}
      }
      if (!opened) return false;
      const previous = normalizeTaskStatuses(readJSON(TASK_STATUS_KEY, {}));
      const next = acknowledgeTaskStatus(previous, id);
      if (!taskStatusesEqual(previous, next)) writeJSON(TASK_STATUS_KEY, next);
      if (typeof onOpened === 'function') onOpened(id);
      return true;
    }

    async function createFreshSession(ctx, workspaceId, onOpened) {
      const sessions = service(ctx, 'sessions');
      const ui = service(ctx, 'uiWorkspace');
      if (!sessions || typeof sessions.create !== 'function') {
        throw new Error('Session creation service is unavailable');
      }
      if (!ui || typeof ui.openSession !== 'function') {
        throw new Error('Session open service is unavailable');
      }
      const options = workspaceId ? { workspaceId: workspaceId } : {};
      const id = await sessions.create(options);
      if (typeof id !== 'string' || !id) throw new Error('Session creation returned no ID');
      if (!(await openSessionSafe(ctx, id, onOpened))) throw new Error('Unable to open newly created session');
      return id;
    }

    // ------------------------------------------------------- active session
    // Layer 1: what the user last clicked in this tree (persisted).
    function readActiveId() {
      const v = readJSON(ACTIVE_KEY, null);
      return typeof v === 'string' && v ? v : undefined;
    }
    function writeActiveId(id) {
      if (!id || !isSessionId(id)) return;
      if (readActiveId() === id) return;
      writeJSON(ACTIVE_KEY, id);
      emit();
    }
    // Layer 2: the conversation view publishes the session it is showing in its
    // own attributes; reading them beats guessing which row is "current".
    function probeHostSessionId() {
      if (typeof document === 'undefined' || !document.querySelector) return undefined;
      const sels = [
        '[data-panel-conversation]',
        '[data-panel="conversation"]',
        '[data-conversation-id]',
        '[data-chat-session]',
        '[data-session-id]',
      ];
      const names = [
        'data-session-id',
        'data-sessionid',
        'data-session',
        'data-conversation-id',
        'data-conversation',
        'data-id',
      ];
      for (let i = 0; i < sels.length; i += 1) {
        let el = null;
        try {
          el = document.querySelector(sels[i]);
        } catch (e) {
          el = null;
        }
        if (!el || !el.getAttribute) continue;
        // Never read our own rows back as host truth.
        if (el.closest && el.closest('.dshbt-sb')) continue;
        for (let j = 0; j < names.length; j += 1) {
          const v = el.getAttribute(names[j]);
          if (isSessionId(v)) return normId(v);
        }
        const attrs = el.attributes || [];
        for (let k = 0; k < attrs.length; k += 1) {
          const v = attrs[k] && attrs[k].value;
          if (isSessionId(v)) return normId(v);
        }
      }
      return undefined;
    }
    // Layer 3: the window title usually names the open conversation.
    function matchActiveByTitle(data, titleOf) {
      let docTitle = '';
      try {
        docTitle = String(document.title || '');
      } catch (e) {
        return undefined;
      }
      if (!docTitle) return undefined;
      let bestId;
      let bestLen = 0;
      data.sessions.forEach(function (s, id) {
        const t = titleOf(id, s && s.title);
        const len = String(t || '').trim().length;
        if (len < 2 || len <= bestLen) return;
        if (docTitle.indexOf(String(t).trim()) >= 0) {
          bestId = id;
          bestLen = len;
        }
      });
      return bestId;
    }

    function workspacePathFor(data, sessionId, titleHint) {
      const ws = (data.workspaces || []).filter(function (w) {
        return (w.sessionIds || []).indexOf(sessionId) >= 0;
      })[0];
      if (ws && ws.path) return ws.path;
      // The snapshot does not always expose workspace.sessionIds, but the
      // workspace folder name equals the workspace title, so match on that.
      const paths = data.paths || [];
      const hint = lastSeg(titleHint || '');
      if (hint) {
        for (let i = 0; i < paths.length; i += 1) {
          if (lastSeg(paths[i]) === hint) return paths[i];
        }
      }
      return undefined;
    }

    function remoteNamespace(ctx, name) {
      try {
        if (ctx && ctx.remote && ctx.remote[name]) return ctx.remote[name];
      } catch (e) {}
      const remote = service(ctx, 'remote');
      if (remote && remote[name]) return remote[name];
      return service(ctx, name) || service(ctx, name + 's');
    }

    // The remote session surface answers in a gateway envelope ({ok, value})
    // while the in-process manager answers with the payload itself; both shapes
    // reach the plugin depending on how the client is wired, so unwrap either.
    function unwrapResult(res) {
      if (res && typeof res === 'object' && typeof res.ok === 'boolean') {
        if (!res.ok) throw res.error || new Error('DSH session request failed');
        return res.value;
      }
      return res;
    }

    // The plugin can be handed the raw remote surface, the manager that wraps
    // it, or a Cordis service that differs per build, so every call site picks
    // the first candidate that actually implements the method it needs.
    function sessionCandidates(ctx) {
      const out = [];
      const push = function (v) {
        if (v && typeof v === "object" && out.indexOf(v) < 0) out.push(v);
      };
      try {
        const remote = ctx && ctx.remote;
        if (remote && remote.session) push(remote.session);
      } catch (e) {}
      push(remoteNamespace(ctx, 'session'));
      push(service(ctx, 'sessions'));
      return out;
    }

    async function promptSession(ctx, params) {
      const list = sessionCandidates(ctx);
      for (let i = 0; i < list.length; i += 1) {
        if (typeof list[i].prompt !== "function") continue;
        const value = unwrapResult(await list[i].prompt(params));
        if (value && value.accepted === false) throw new Error('DSH did not accept the prompt');
        return value;
      }
      throw new Error('DSH session prompt API is unavailable');
    }

    // The remote session surface has no wait() method: the only way to know a
    // queued turn finished is to follow the session's own event stream until its
    // turn/end. wait() is still used when a build happens to expose it.
    async function waitForTurn(ctx, sessionId, afterSeq, timeoutMs) {
      const list = sessionCandidates(ctx);
      for (let i = 0; i < list.length; i += 1) {
        if (typeof list[i].wait !== "function") continue;
        const result = await list[i].wait({
          sessionId: sessionId,
          timeoutMs: timeoutMs,
          maxMessages: 40,
        });
        if (result && (result.reason === "timeout" || result.reason === "input-required")) {
          throw new Error('model did not finish: ' + result.reason);
        }
        return true;
      }
      let streamer = null;
      for (let i = 0; i < list.length; i += 1) {
        if (typeof list[i].follow === "function") {
          streamer = list[i];
          break;
        }
      }
      if (!streamer) {
        throw new Error('DSH session follow API is unavailable');
      }
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timedOut = false;
      const timer = setTimeout(function () {
        timedOut = true;
        try {
          if (controller) controller.abort();
        } catch (e) {}
      }, timeoutMs);
      let answered = false;
      try {
        const stream = streamer.follow(
          {
            address: { kind: 'session', sessionId: sessionId },
            assistantStream: true,
          },
          controller ? controller.signal : undefined
        );
        for await (const frame of stream) {
          if (!frame || frame.type !== 'entry') continue;
          const ev = frame.entry && frame.entry.event;
          if (!ev || typeof ev.seq !== 'number' || ev.seq <= afterSeq) continue;
          if (ev.type === 'assistant/message') answered = true;
          if (answered && ev.type === 'turn/end') return true;
        }
      } finally {
        clearTimeout(timer);
      }
      if (timedOut) throw new Error('model did not finish: timeout');
      if (!answered) throw new Error('model did not answer before the stream ended');
      return true;
    }

    async function latestSeqOf(mgr, sessionId) {
      if (!mgr || typeof mgr.retain !== 'function') return 0;
      const ref = mgr.retain(sessionId, { source: SOURCE });
      try {
        if (ref && ref.ready && typeof ref.ready.then === 'function') {
          try {
            await ref.ready;
          } catch (e) {}
        }
        const entries = await readWholeSession(ref);
        return entries.reduce(function (m, e) {
          const s = e && e.event && e.event.seq;
          return typeof s === 'number' && s > m ? s : m;
        }, 0);
      } finally {
        releaseRef(ref);
      }
    }

    async function lastAssistantTextOf(mgr, sessionId) {
      if (!mgr || typeof mgr.retain !== 'function') return '';
      const ref = mgr.retain(sessionId, { source: SOURCE });
      try {
        if (ref && ref.ready && typeof ref.ready.then === 'function') {
          try {
            await ref.ready;
          } catch (e) {}
        }
        const entries = await readWholeSession(ref);
        for (let i = entries.length - 1; i >= 0; i -= 1) {
          if (roleOf(entries[i]) !== 'assistant') continue;
          const text = messageText(entries[i]).trim();
          if (text) return text;
        }
        return '';
      } finally {
        releaseRef(ref);
      }
    }

    async function openScratchSession(ctx, workspaceId) {
      const mgr = service(ctx, 'sessions');
      if (!mgr || typeof mgr.create !== 'function') {
        throw new Error('DSH session create API is unavailable');
      }
      const id = await mgr.create(workspaceId ? { workspaceId: workspaceId } : {});
      if (typeof id !== 'string' || !id) throw new Error('DSH session create returned no id');
      return id;
    }

    function archiveQuietly(ctx, id) {
      if (!id) return;
      try {
        const ws = service(ctx, 'workspaces');
        if (ws && typeof ws.archiveSession === 'function') {
          const p = ws.archiveSession(id, { stopActivity: true });
          if (p && typeof p.catch === 'function') p.catch(function () {});
          return;
        }
      } catch (e) {}
      try {
        const ui = service(ctx, 'uiWorkspace');
        if (ui && typeof ui.archiveSession === 'function') {
          const p = ui.archiveSession(id);
          if (p && typeof p.catch === 'function') p.catch(function () {});
        }
      } catch (e) {}
    }

    function workspaceIdFor(data, id) {
      const list = (data && data.workspaces) || [];
      for (let i = 0; i < list.length; i += 1) {
        const w = list[i];
        if (w && Array.isArray(w.sessionIds) && w.sessionIds.indexOf(id) >= 0) return w.id;
      }
      return list[0] ? list[0].id : undefined;
    }

    // An empty branch: fork at seq 0 keeps the workspace association and the
    // lineage; creating a plain session is the fallback when a build refuses a
    // zero-length prefix.
    function forkEmptySession(ctx, sessions, sourceId, workspaceId) {
      return (async function () {
        try {
          const raw = await sessions.fork({ sessionId: sourceId, atSeq: 0 });
          const value = unwrapResult(raw);
          const id = value && typeof value === 'object' ? value.sessionId : value;
          if (id) return String(id);
        } catch (e) {}
        return openScratchSession(ctx, workspaceId);
      })();
    }

    function copyText(text) {
      try {
        const p = writeClipboard(String(text));
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (e) {}
    }

    function releaseRef(ref) {
      try {
        if (ref && typeof ref.release === 'function') ref.release();
      } catch (e) {}
    }

    // --------------------------------------------------- inherited memory mode
    // DSH keeps no compaction artifact in a session log: compression in this
    // setup happens outside DSH (a proxy rewrites each request), so a plain fork
    // always copies raw history. Returning "A's compressed memory" therefore has
    // to be manufactured here: read A up to the fork seq, condense it, then write
    // the digest into the child as its own context seed. The child never reads A
    // again, so later edits to A cannot reach it.
    const INHERIT_DIGEST_CHARS = 12000;
    const INHERIT_TURN_CHARS = 700;
    const INHERIT_PROMPT_CHARS = 60000;
    const INHERIT_TIMEOUT_MS = 240000;

    function messageText(entry) {
      const data = (entry && entry.event && entry.event.data) || {};
      // An assistant turn stores its parts nested one level down, under
      // `data.message.content`, with the model/provider metadata beside it.
      // Reading only `data.content` therefore sees nothing on the assistant
      // side and drops every reply from the transcript.
      const content = Array.isArray(data.content)
        ? data.content
        : (data.message && data.message.content) || data.content;
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';
      return content
        .map(function (part) {
          if (!part || typeof part !== 'object') return '';
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    function clip(text, limit) {
      const s = String(text == null ? '' : text);
      if (s.length <= limit) return s;
      const head = s.slice(0, Math.ceil(limit * 0.7));
      const tail = s.slice(s.length - Math.floor(limit * 0.25));
      return head + '\n…[省略 ' + (s.length - head.length - tail.length) + ' 字]…\n' + tail;
    }
    function roleOf(entry) {
      const type = String((entry && entry.event && entry.event.type) || '').toLowerCase();
      if (/^user[/_-]message$/.test(type)) return 'user';
      if (/^assistant[/_-](?:message|final|response)$/.test(type)) return 'assistant';
      return '';
    }
    function isInternalSeed(text) {
      return /<!--\s*dsh-branch-tree:seed/i.test(String(text || ''));
    }
    // Host-injected user blocks (runtime context, skill catalog, time snapshot,
    // memory snapshot) share the `user/message` type with real turns. They must
    // never be inherited: the branch would wake up parsing another session's
    // sandbox policy, or re-reading a skill catalog for a task it does not have.
    // `source.kind` is the host's own tag, so anything other than 'user' is an
    // injected block; when the tag is missing fall back to the known headers.
    const SEED_BLOCK_HEADERS = [
      'Current runtime context',
      'Current DSH file policy',
      'Current DeepSeek Harness implementation checkout',
      'Current DeepSeek Harness Web GUI URL',
      '[记忆定位',
      '[记忆系统',
      '[规则 — 用户级硬性约束',
    ];
    function isSeedUserEntry(entry) {
      const ev = entry && entry.event;
      if (!ev || roleOf(entry) !== 'user') return false;
      const kind = (ev.data && ev.data.source && ev.data.source.kind) || (ev.source && ev.source.kind) || '';
      if (kind && kind !== 'user') return true;
      const text = String(messageText(entry) || '').replace(/^\s+/, '');
      if (!text) return false;
      const head = text.slice(0, 160);
      if (/^<!--\s*dsh-(?:runtime|seed|plugin)/i.test(head)) return true;
      return SEED_BLOCK_HEADERS.some(function (marker) {
        return head.indexOf(marker) >= 0;
      });
    }
    function turnOf(entry) {
      const data = (entry && entry.event && entry.event.data) || {};
      return typeof data.turn === 'number' ? data.turn : null;
    }

    // Load every event the session has, not just the first page. `loadOlder`
    // pulls the previous page, so loop until the window stops growing.
    async function readWholeSession(ref) {
      const binding = (ref && ref.binding) || {};
      const source = (ref && ref.eventSource) || binding.eventSource;
      const session = binding.session;
      const entries = entriesOf(source).entries.slice();
      let guard = 0;
      while (guard < 400 && session && typeof session.loadOlder === 'function') {
        guard += 1;
        const before = entries.length;
        try {
          await session.loadOlder();
        } catch (e) {
          break;
        }
        const win = eventWindowOf(source);
        const next = entriesOf(source).entries.slice();
        // Dedupe by seq, not by identity: loadOlder can hand back the same
        // event as a fresh object, and identity checks then double every line.
        const seen = {};
        for (let i = 0; i < entries.length; i += 1) {
          const s = entries[i] && entries[i].event && entries[i].event.seq;
          if (typeof s === 'number') seen[s] = true;
        }
        for (let i = 0; i < next.length; i += 1) {
          const s = next[i] && next[i].event && next[i].event.seq;
          if (typeof s === 'number' ? !seen[s] : entries.indexOf(next[i]) < 0) {
            if (typeof s === 'number') seen[s] = true;
            entries.push(next[i]);
          }
        }
        if (entries.length === before) break;
        if (!win || win.hasMore !== true) break;
        await wait(20);
      }
      entries.sort(function (a, b) {
        const sa = (a && a.event && a.event.seq) || 0;
        const sb = (b && b.event && b.event.seq) || 0;
        return sa - sb;
      });
      return entries;
    }

    // Fork with the host's own default when our seq cannot be honoured. The
    // host rejects an atSeq it cannot find (\`session/fork-unavailable\`) and, when
    // no atSeq is given, falls back to its own latest-completed-turn prefix —
    // which is still the whole conversation. Losing the branch because the
    // master happened to be mid-turn is strictly worse than forking a little
    // earlier, so the last resort drops the explicit seq entirely.
    async function forkSession(sessions, sourceId, atSeq) {
      // The remote fork schema accepts only sessionId / atSeq / allowMigration,
      // and answers in a gateway envelope. An extra key (increaseTitle) makes a
      // strict schema reject the call outright, and an unwrapped envelope makes
      // the returned "id" an object, so both are handled here.
      const attempt = async function (seq) {
        const params = { sessionId: sourceId };
        if (typeof seq === 'number') params.atSeq = seq;
        const raw = await sessions.fork(params);
        const value = unwrapResult(raw);
        const id = value && typeof value === 'object' ? value.sessionId || value.id : value;
        if (!id) throw new Error('fork returned no session id');
        return String(id);
      };
      try {
        return await attempt(atSeq);
      } catch (e) {
        const code = String((e && (e.code || (e.rpcError && e.rpcError.code))) || '');
        const msg = String((e && e.message) || '');
        const unusable =
          code.indexOf('fork-unavailable') >= 0 ||
          msg.indexOf('fork/unavailable') >= 0 ||
          msg.indexOf('does not exist in session') >= 0;
        if (!unusable) throw e;
        return await attempt(undefined);
      }
    }

    // The fork point for "inherit everything" is the master's LAST real
    // dialogue event, not the last event of any kind and not the end of the
    // first turn. Everything the master has done so far must travel.
    //
    // Taking the maximum seq directly is wrong on any live session: the host
    // keeps writing housekeeping after the last message (session/title,
    // request/header, session-log-deepseek delivery), so the max seq sits past
    // the conversation. A prefix ending there is what the host refuses to
    // materialise, and the branch opens on an empty history.
    //
    // Cut at the LAST real user message instead: assistant messages after it
    // are a reply to something the user has not said yet, and partial tool
    // exchanges cannot be replayed. That lands the branch exactly at the point
    // where the master is waiting for its user, which is also the point where
    // the user clicks "branch".
    async function readInheritBoundary(ref) {
      const entries = await readWholeSession(ref);
      const binding0 = (ref && ref.binding) || {};
      const openBoundary = function () {
        return completedTurnBoundary(
          eventsOf((ref && ref.eventSource) || binding0.eventSource)
        );
      };
      const real = entries.filter(function (e) {
        return roleOf(e) && !isSeedUserEntry(e);
      });
      const turns = real.filter(function (e) {
        return roleOf(e) === 'user';
      }).length;
      const users = real
        .filter(function (e) {
          return roleOf(e) === 'user';
        })
        .map(function (e) {
          return e.event.seq;
        })
        .filter(function (s) {
          return typeof s === 'number';
        });
      // Extend to the assistant reply that answers the last user message: it
      // is part of what the master has already said, and a branch cut before
      // it loses a whole answer. Mutating stages (step/end, request/header,
      // delivery) are still excluded.
      const lastUser = users.length ? users[users.length - 1] : undefined;
      let atSeq = lastUser;
      if (typeof lastUser === 'number') {
        const after = real
          .filter(function (e) {
            return roleOf(e) === 'assistant' && typeof e.event.seq === 'number' && e.event.seq > lastUser;
          })
          .map(function (e) {
            return e.event.seq;
          })
          .sort(function (a, b) {
            return a - b;
          });
        if (after.length) atSeq = after[after.length - 1];
      }
      if (typeof atSeq !== 'number') {
        // A session that never got one of its own messages: fall back to the
        // last assistant turn so the branch at least carries its answer.
        const lasts = real
          .map(function (e) {
            return e.event.seq;
          })
          .filter(function (s) {
            return typeof s === 'number';
          });
        atSeq = lasts.length ? lasts[lasts.length - 1] : undefined;
      }
      // The seq above is the master's last real message and would be the ideal
      // cut, but the host only materialises a completed-turn prefix: a
      // mid-turn seq, or one the loaded page never saw, leaves events[atSeq]
      // undefined and the host either throws session/fork-unavailable or seeds
      // the branch with nothing. Resolve to the newest completed turn instead
      // and report the gap honestly.
      const open = openBoundary();
      if (typeof open === 'number') {
        // Nothing newer than the completed turn: the ideal cut is already a
        // prefix the host will copy, so keep it (that is the fork point the
        // menu itself uses: the turn's own end).
        if (open <= atSeq) return { atSeq: atSeq, degraded: false, turns: turns };
        const live = eventsOf((ref && ref.eventSource) || binding0.eventSource);
        const pending = live.some(function (ev) {
          return (
            ev &&
            ev.type === 'user/message' &&
            typeof ev.seq === 'number' &&
            ev.seq > open &&
            !isSeedUserEntry({ event: ev })
          );
        });
        return { atSeq: open, degraded: !!pending, turns: turns };
      }
      return { atSeq: atSeq, degraded: typeof atSeq !== 'number', turns: turns };
    }

    // Deterministic fallback digest: used when the model cannot be reached or
    // does not finish in time, so the branch still gets *something* rather than
    // silently inheriting raw history.
    function mechanicalDigest(entries, atSeq) {
      const picked = [];
      let chars = 0;
      for (let i = 0; i < entries.length; i += 1) {
        const e = entries[i];
        const ev = e && e.event;
        if (!ev || typeof ev.seq !== 'number' || ev.seq > atSeq) continue;
        const role = roleOf(e);
        if (!role || isSeedUserEntry(e)) continue;
        const text = messageText(e);
        if (!text.trim() || isInternalSeed(text)) continue;
        const turn = turnOf(e);
        const body = clip(text.trim().replace(/\s+/g, ' '), INHERIT_TURN_CHARS);
        const line = '【' + (role === 'user' ? '用户' : '助手') + (turn == null ? '' : ' · 轮' + turn) + '】' + body;
        if (chars + line.length > INHERIT_DIGEST_CHARS) break;
        picked.push(line);
        chars += line.length + 1;
      }
      return picked.join('\n');
    }

    function compressionPrompt(sourceTitle, atSeq, turns, transcript) {
      return [
        '你在为一个会话分支生成「压缩记忆」。不要调用任何工具，不要写文件，不要继续原任务——只输出摘要正文。',
        '母会话标题：' + (sourceTitle || '(未命名)'),
        '分叉点：第 ' + atSeq + ' 个事件（含）；共 ' + turns + ' 轮用户发言。',
        '',
        '下面是母会话从开头到分叉点的记录。请把它压缩成一份**可独立续跑**的记忆，用 Markdown 输出，严格按以下小节：',
        '',
        '## 任务目标',
        '用户到底要什么，一句话到三句话。',
        '',
        '## 已确认的事实与约束',
        '用户给的硬约束、偏好、规则、文件命名要求、环境事实（路径、版本、接口名）。逐条列，宁可具体不要笼统。',
        '',
        '## 已完成',
        '已经做成的事，带可验证的结果（改了什么文件、跑出什么数字）。',
        '',
        '## 关键决策与理由',
        '选了什么方案、为什么、否决了哪些方案及原因。',
        '',
        '## 未决问题与下一步',
        '还没解决的、待确认的、下一步该干什么。',
        '',
        '## 重要锚点',
        '文件路径、标识符、命令、错误原文——凡是续跑时要原样用到的，逐条抄下来，不要改写。',
        '',
        '要求：只写记录里真有的内容，不要编造；总长控制在 8000 字以内；不要复述过程流水账，只留结论与可复用事实。',
        '',
        '===== 母会话记录开始 =====',
        clip(transcript, INHERIT_PROMPT_CHARS),
        '===== 母会话记录结束 =====',
      ].join('\n');
    }

    function seedText(meta, digest) {
      return [
        '<!-- dsh-branch-tree:seed v1 source=' + meta.sourceTitle + ' atSeq=' + meta.atSeq + ' -->',
        '【' + L('inherited') + '】' + L('inheritFrom') + '「' + (meta.sourceTitle || '') + '」，分叉点 seq=' + meta.atSeq + '。',
        L('seamNote'),
        '',
        digest.trim(),
        '',
        '（以上是你的继承记忆。不要复述，不要执行任何任务，只回一句「已就绪」，然后等我说话。）',
      ].join('\n');
    }

    // Ask the model to compress the master. This runs in a throwaway session in
    // the same workspace, never in the master itself: a prompt there would leave
    // a "summarise yourself" turn inside the user's own conversation, and the
    // master is supposed to stay exactly as it was. The scratch session is
    // archived as soon as its answer has been read back.
    async function compressWithModel(ctx, args) {
      const mgr = service(ctx, 'sessions');
      if (!mgr) throw new Error('DSH session service is unavailable');
      if (!sessionCandidates(ctx).some(function (v) { return typeof v.prompt === 'function'; })) {
        throw new Error('DSH session prompt API is unavailable');
      }
      let raw = '';
      const ref = mgr.retain(args.sourceId, { source: SOURCE });
      try {
        if (ref && ref.ready && typeof ref.ready.then === 'function') {
          try {
            await ref.ready;
          } catch (e) {}
        }
        raw = mechanicalDigest(await readWholeSession(ref), args.atSeq);
      } finally {
        releaseRef(ref);
      }
      const scratchId = await openScratchSession(ctx, args.workspaceId);
      try {
        const requestId = 'dshbt-digest-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        await promptSession(ctx, {
          requestId: requestId,
          sessionId: scratchId,
          mode: 'queue',
          content: [
            { type: 'text', text: compressionPrompt(args.sourceTitle, args.atSeq, args.turns, raw) },
          ],
        });
        await waitForTurn(ctx, scratchId, 0, INHERIT_TIMEOUT_MS);
        const digest = await lastAssistantTextOf(mgr, scratchId);
        // A short answer is not a digest: the fallback already carries more.
        if (digest && digest.length >= 100) return { digest: digest, source: 'model' };
        return { digest: raw, source: 'mechanical' };
      } finally {
        archiveQuietly(ctx, scratchId);
      }
    }

    // Hands the digest to the new branch as its first message. The remote
    // prompt surface accepts only 'queue' and 'steer'; 'queue' spends exactly one
    // turn in the fresh branch, which is what a seed wants: the branch reads its
    // inherited memory once, answers in one line, and then waits for the user.
    async function seedChildWithDigest(ctx, childId, meta, digest) {
      const requestId = 'dshbt-seedchild-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      await promptSession(ctx, {
        requestId: requestId,
        sessionId: childId,
        mode: 'queue',
        content: [{ type: 'text', text: seedText(meta, digest) }],
      });
      return true;
    }


    async function makeDirPath(ui, wsPath, relDir) {
      const parts = String(relDir).split('/').filter(Boolean);
      let abs = wsPath;
      for (let i = 0; i < parts.length; i += 1) {
        await ui.createDirectory(abs, parts[i]);
        abs = abs + '/' + parts[i];
      }
    }

    // `source` is the session to fork from (a master, or a branch that itself
    // acts as a folder); `opts` carries the parent folder identity.
    async function createBranch(ctx, source, name, data, opts) {
      const title = sanitizeName(name);
      if (!title) throw new Error(L('needName'));
      const o = opts || {};
      const sessions = service(ctx, 'sessions');
      const ui = service(ctx, 'uiWorkspace');
      if (!sessions || typeof sessions.fork !== 'function') throw new Error('sessions service unavailable');
      const fromId = (source && source.id) || o.parentId;
      const masterId = o.masterId || fromId;
      const masterTitle = o.masterTitle || (source && source.title) || '';
      const ref = sessions.retain(fromId, { source: SOURCE });
      // 'inherit' = compress the master into a digest; 'full' (default) = a
      // verbatim fork; 'opening' = the old turn-1-only cut.
      const inheritMode = o.inheritMode === 'inherit' ? 'inherit' : o.inheritMode === 'opening' ? 'opening' : 'full';
      let boundary;
      let digest = '';
      let digestSource = 'mechanical';
      let lastCompressError = null;
      try {
        boundary =
          inheritMode === 'opening' ? await readForkBoundary(ref) : await readInheritBoundary(ref);
      } finally {
        releaseRef(ref);
      }
      const workspaceId = workspaceIdFor(data, fromId);
      if (inheritMode === 'inherit' && boundary.turns > 0) {
        try {
          const made = await compressWithModel(ctx, {
            sourceId: fromId,
            sourceTitle: masterTitle,
            atSeq: boundary.atSeq,
            turns: boundary.turns,
            workspaceId: workspaceId,
          });
          digest = made.digest;
          digestSource = made.source;
        } catch (e) {
          lastCompressError = (e && e.message) || String(e);
          const refs = sessions.retain(fromId, { source: SOURCE });
          try {
            digest = mechanicalDigest(await readWholeSession(refs), boundary.atSeq);
          } catch (e2) {
            digest = '';
          } finally {
            releaseRef(refs);
          }
          digestSource = 'mechanical';
        }
      }
      const masterDir = sanitizeName(masterTitle) || 'master';
      let relDir = o.parentDir
        ? String(o.parentDir) + '/' + title
        : OUTPUT_ROOT + '/' + masterDir + '/' + title;
      // Branch names are free text, so two siblings can collide; without a
      // suffix the second branch would silently write into the first dir.
      const takenDirs = (loadStore().branches || []).map(function (b) {
        return b && b.dir;
      });
      if (takenDirs.indexOf(relDir) >= 0) {
        const baseDir = relDir;
        let n = 2;
        while (takenDirs.indexOf(baseDir + ' (' + n + ')') >= 0) n += 1;
        relDir = baseDir + ' (' + n + ')';
      }
      const wsPath =
        workspacePathFor(data, fromId, masterTitle) ||
        workspacePathFor(data, masterId, masterTitle) ||
        workspacePathFor(data, masterId, (data.workspaces[0] || {}).title);
      let madeDir = false;
      if (wsPath && ui && typeof ui.createDirectory === 'function') {
        try {
          await makeDirPath(ui, wsPath, relDir);
          madeDir = true;
        } catch (e) {
          madeDir = false;
        }
      }
      let childId;
      // An 'inherit' branch must not see the master's raw history, so it is
      // started empty and then handed the digest as its entire context. The
      // empty-fork probe below does not apply to it: empty is the design.
      const seedOnly = inheritMode === 'inherit' && !!digest;
      if (seedOnly) {
        childId = await forkEmptySession(ctx, sessions, fromId, workspaceId);
      } else {
        // An empty fork is the one failure the host never reports: it copies a
        // zero-event prefix and starts "successfully". Probe the child, and if it
        // came back with nothing inherited, fork again letting the host pick its
        // own completed-turn boundary.
        try {
          childId = await forkSession(sessions, fromId, boundary.atSeq);
          for (let attempt = 0; attempt < EMPTY_FORK_RETRIES; attempt += 1) {
            const inherited = await inheritedCountOf(sessions, childId, fromId);
            if (inherited !== 0) break;
            // There is no delete API on the remote surface; archiving the dud
            // fork is the closest equivalent and keeps it out of the tree.
            archiveQuietly(ctx, childId);
            childId = await forkSession(sessions, fromId, undefined);
          }
          emptyFork = (await inheritedCountOf(sessions, childId, fromId)) === 0;
        } catch (e) {
          try {
            if (ui && typeof ui.openSession === 'function') await ui.openSession(fromId);
          } catch (e2) {}
          await wait(500);
          const ref2 = sessions.retain(fromId, { source: SOURCE });
          let atSeq = boundary.atSeq;
          try {
            atSeq =
              ((inheritMode === 'opening'
                ? await readForkBoundary(ref2)
                : await readInheritBoundary(ref2)) || {}).atSeq;
            if (typeof atSeq !== 'number') atSeq = boundary.atSeq;
          } catch (e3) {
          } finally {
            try {
              if (ref2 && typeof ref2.release === 'function') ref2.release();
            } catch (e4) {}
          }
          childId = await forkSession(sessions, fromId, atSeq);
        }
      }
      const finalInherited = await inheritedCountOf(sessions, childId, fromId);
      if (!seedOnly && typeof finalInherited === 'number') emptyFork = finalInherited === 0;
      const childRef = sessions.retain(childId, { source: SOURCE });
      try {
        const face = childRef && childRef.binding && childRef.binding.session;
        if (face && typeof face.rename === 'function') {
          await face.rename(title);
        }
      } catch (e) {
      } finally {
        try {
          if (childRef && typeof childRef.release === 'function') childRef.release();
        } catch (e) {}
      }
      if (inheritMode === 'inherit' && digest) {
        try {
          await seedChildWithDigest(
            ctx,
            childId,
            { sourceTitle: masterTitle, atSeq: boundary.atSeq },
            digest
          );
        } catch (e) {
          digestSource = 'failed';
        }
      }
      const store = loadStore();
      const entry = {
        masterId: masterId,
        masterTitle: masterTitle,
        parentId: o.parentId || fromId,
        branchId: childId,
        name: title,
        dir: relDir,
        seq: boundary.atSeq,
        createdAt: Date.now(),
        degraded: !!boundary.degraded || !!emptyFork,
        emptyFork: emptyFork || undefined,
        madeDir: madeDir,
        // 'full' is the default and is left off the record so older entries
        // (which predate the field) keep meaning "the default behaviour".
        inheritMode: inheritMode === 'full' ? undefined : inheritMode,
        digestSource: inheritMode === 'inherit' ? digestSource : undefined,
        digestChars: inheritMode === 'inherit' ? digest.length : undefined,
        compressError: inheritMode === 'inherit' ? lastCompressError : undefined,
      };
      const nested = !!(o.parentId && o.parentId !== masterId);
      const masters = nested
        ? store.masters
        : store.masters
            .filter(function (m) {
              return m.id !== masterId;
            })
            .concat([{ id: masterId, title: masterTitle || title }]);
      patchStore({ masters: masters, branches: store.branches.concat([entry]) });
      return entry;
    }

    // ------------------------------------------------------------------ icons
    function icon(paths, size) {
      const list = Array.isArray(paths) ? paths : [paths];
      return h(
        'svg',
        {
          width: size || 14,
          height: size || 14,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { flex: 'none', display: 'block' },
        },
        list.map(function (p, i) {
          if (typeof p === 'string') return h('path', { key: i, d: p });
          return h(p.tag || 'circle', Object.assign({ key: i }, p.attrs || {}));
        })
      );
    }
    const ICONS = {
      caret: 'M9 6l6 6-6 6',
      branch: ['M7 4v10', 'M7 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M17 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M17 8c0 4-4 4-8 6'],
      chat: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9l-5 4z',
      plus: 'M12 5v14M5 12h14',
      dots: [
        { tag: 'circle', attrs: { cx: 5, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' } },
        { tag: 'circle', attrs: { cx: 12, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' } },
        { tag: 'circle', attrs: { cx: 19, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' } },
      ],
      search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M16.5 16.5L21 21'],
      edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z'],
      undo: ['M4 9h9.5a5 5 0 0 1 0 10H8', 'M8 5L4 9l4 4'],
      box: ['M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v2A2.5 2.5 0 0 1 18.5 13h-13A2.5 2.5 0 0 1 3 10.5z', 'M6 13v5.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V13', 'M10 16h4'],
    };
    function I(name, size) {
      if (name === 'folderOpen') return h(IconFolderOpenRegular, { size: size || 14 });
      if (name === 'folder') return h(IconFolderCloseRegular, { size: size || 14 });
      return icon(ICONS[name], size);
    }

    // Survives re-renders: a store write during `dragover` re-renders TreeBody
    // and used to wipe the drag state, so the drop never fired.
    let dragSrc = null;

    // -------------------------------------------------------------- primitives
    function Btn(props) {
      return h(
        'button',
        {
          type: 'button',
          className:
            'dshbt-btn' + (props.primary ? ' dshbt-btn-primary' : '') + (props.small ? ' dshbt-btn-sm' : ''),
          disabled: !!props.disabled,
          title: props.title || undefined,
          onClick: function (e) {
            e.stopPropagation();
            if (!props.disabled && props.onClick) props.onClick(e);
          },
        },
        props.children
      );
    }

    function IconBtn(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dshbt-icon-btn',
          title: props.title || undefined,
          onClick: function (e) {
            e.stopPropagation();
            if (props.onClick) props.onClick(e);
          },
        },
        I(props.name, props.size || 14)
      );
    }

    function menuPositionForRect(rect, itemCount, viewportWidth, viewportHeight) {
      const margin = 8;
      const gap = 6;
      const width = Math.min(220, Math.max(120, viewportWidth - margin * 2));
      const desiredHeight = 12 + Math.max(1, itemCount) * 31;
      const above = Math.max(0, rect.top - gap - margin);
      const below = Math.max(0, viewportHeight - rect.bottom - gap - margin);
      const placeAbove = desiredHeight > below && above > below;
      const room = placeAbove ? above : below;
      const maxHeight = Math.max(0, Math.min(desiredHeight, room || viewportHeight - margin * 2));
      const left = Math.max(margin, Math.min(rect.right - width, viewportWidth - width - margin));
      const top = placeAbove
        ? Math.max(margin, rect.top - gap - maxHeight)
        : Math.min(viewportHeight - margin - maxHeight, rect.bottom + gap);
      return { top: top, left: left, width: width, maxHeight: maxHeight, placement: placeAbove ? 'above' : 'below' };
    }

    // -------------------------------------------------------------------- tree
    function TreeBody(props) {
      const ctx = props.ctx;
      const data = props.data;
      useVersion();
      const sQuery = useState('');
      const query = sQuery[0];
      const setQuery = sQuery[1];
      const sCollapsed = useState(function () {
        return readJSON(COLLAPSE_KEY, []);
      });
      const collapsed = sCollapsed[0];
      const setCollapsed = sCollapsed[1];
      const sMenu = useState(null);
      const menu = sMenu[0];
      const setMenu = sMenu[1];
      const sMenuPos = useState(null);
      const menuPos = sMenuPos[0];
      const setMenuPos = sMenuPos[1];
      const sShowBranchCounts = useState(function () {
        return readJSON(SHOW_BRANCH_COUNTS_KEY, true) !== false;
      });
      const showBranchCounts = sShowBranchCounts[0];
      const setShowBranchCounts = sShowBranchCounts[1];
      const sDraft = useState(null);
      const draft = sDraft[0];
      const setDraft = sDraft[1];
      const sBusy = useState(false);
      const busy = sBusy[0];
      const setBusy = sBusy[1];
      const sessionCreateRef = React.useRef(false);
      const sRenaming = useState(null);
      const renaming = sRenaming[0];
      const setRenaming = sRenaming[1];
      const sNote = useState(null);
      const note = sNote[0];
      const setNote = sNote[1];
      const sWsMenu = useState(false);
      const wsMenu = sWsMenu[0];
      const setWsMenu = sWsMenu[1];
      const sCascadeOpen = useState(null);
      const cascadeOpen = sCascadeOpen[0];
      const cascadePath = Array.isArray(cascadeOpen) ? cascadeOpen : (cascadeOpen ? [cascadeOpen] : []);
      const setCascadeOpen = sCascadeOpen[1];
      const sWsActionMenu = useState(null);
      const wsActionMenu = sWsActionMenu[0];
      const setWsActionMenu = sWsActionMenu[1];
      const sTitles = useState({});
      const titles = sTitles[0];
      const setTitles = sTitles[1];
      const sDrag = useState(null);
      const drag = sDrag[0];
      const setDrag = sDrag[1];
      const sDrop = useState(null);
      const drop = sDrop[0];
      const setDrop = sDrop[1];
      const sUnstarted = useState([]);
      const unstartedIds = sUnstarted[0];
      const setUnstartedIds = sUnstarted[1];
      const sTaskStatuses = useState(function () {
        return normalizeTaskStatuses(readJSON(TASK_STATUS_KEY, {}));
      });
      const taskStatuses = sTaskStatuses[0];
      const setTaskStatuses = sTaskStatuses[1];
      const sessionIds = Array.from(data.sessions.keys()).sort();
      const sessionIdsKey = JSON.stringify(sessionIds);
      useEffect(
        function () {
          const next = reconcileTaskStatuses(taskStatuses, data.sessions);
          if (taskStatusesEqual(taskStatuses, next)) return;
          setTaskStatuses(next);
          writeJSON(TASK_STATUS_KEY, next);
        },
        [data.sessions, taskStatuses]
      );
      useEffect(
        function () {
          let alive = true;
          (async function () {
            const hidden = [];
            // Limit concurrent retains so a large workspace list does not spike
            // the host while checking which rows are genuinely blank.
            for (let i = 0; i < sessionIds.length; i += 8) {
              const batch = sessionIds.slice(i, i + 8);
              const results = await Promise.all(
                batch.map(function (id) {
                  // A blank session is usually a row the user just created and
                  // has not typed into yet. Archiving it on the host destroys
                  // it, so blank rows are only hidden in this render pass.
                  return isUnstartedSession(ctx, id).then(function (blank) {
                    return blank ? id : null;
                  });
                })
              );
              results.forEach(function (id) {
                if (id) hidden.push(id);
              });
              if (!alive) return;
            }
            if (alive) setUnstartedIds(hidden);
          })();
          return function () {
            alive = false;
          };
        },
        [ctx, sessionIdsKey]
      );

      const store = loadStore();
      // The host sometimes knows the open conversation and sometimes does not;
      // the last click always does. Whichever is available drives the black row.
      const activeId = data.activeId || readActiveId();
      const acknowledge = useCallback(
        function (id) {
          setTaskStatuses(function (previous) {
            const next = acknowledgeTaskStatus(previous, id);
            if (!taskStatusesEqual(previous, next)) writeJSON(TASK_STATUS_KEY, next);
            return next;
          });
        },
        []
      );
      const activate = useCallback(
        function (id) {
          writeActiveId(id);
          openSessionSafe(ctx, id, acknowledge);
        },
        [acknowledge, ctx]
      );
      // Keyed on the shape of the tree, not on the row counts: re-parenting
      // changes membership without changing any count, and a memo keyed on
      // .length alone keeps drawing the branch under its old parent.
      const storeShape =
        store.branches
          .map(function (b) {
            return b.branchId + '>' + b.parentId + ':' + b.name;
          })
          .join('|') +
        '#' +
        store.masters
          .map(function (m) {
            return (m.id || m.masterId) + ':' + m.title;
          })
          .join('|');
      const forest = useMemo(
        function () {
          return groupsOf(store);
        },
        [storeShape]
      );
      const groupById = forest.byId;
      const branchIds = useMemo(
        function () {
          const s = new Set();
          store.branches.forEach(function (b) {
            s.add(b.branchId);
          });
          return s;
        },
        [storeShape]
      );

      const toggle = useCallback(function (id) {
        setCollapsed(function (prev) {
          const next =
            prev.indexOf(id) >= 0
              ? prev.filter(function (x) {
                  return x !== id;
                })
              : prev.concat([id]);
          writeJSON(COLLAPSE_KEY, next);
          return next;
        });
      }, []);

      const titleOf = useCallback(
        function (id, fallback) {
          const t = (titles && titles[id]) || (data.sessions.get(id) || {}).title;
          if (t) return t;
          const fb =
            typeof fallback === 'string' && fallback && !isSessionId(fallback) ? fallback : '';
          return fb || sessionLabel(id);
        },
        [data.sessions, titles]
      );

      // Preferred source: the host says which conversation is open. Recording it
      // keeps the black row correct across re-renders and reloads.
      useEffect(
        function () {
          if (data.activeId) writeActiveId(data.activeId);
        },
        [data.activeId]
      );
      // Fallback sources (DOM attribute, window title) are polled and only
      // adopted after two agreeing ticks, so a transient DOM state cannot make
      // the highlighted row jump around while the view is switching.
      const probeRef = React.useRef(null);
      probeRef.current = { data: data, titleOf: titleOf };
      useEffect(function () {
        let alive = true;
        let pending;
        const tick = function () {
          if (!alive) return;
          const tree = probeRef.current || {};
          let found;
          try {
            found = probeHostSessionId() || matchActiveByTitle(tree.data, tree.titleOf);
          } catch (e) {
            found = undefined;
          }
          if (!found) {
            pending = undefined;
            return;
          }
          if (found !== pending) {
            pending = found;
            return;
          }
          writeActiveId(found);
        };
        const timer = setInterval(tick, 1200);
        tick();
        return function () {
          alive = false;
          clearInterval(timer);
        };
      }, []);

      const q = query.trim().toLowerCase();
      const match = useCallback(
        function (text) {
          return !q || String(text || '').toLowerCase().indexOf(q) >= 0;
        },
        [q]
      );

      async function runRename(id, next) {
        setRenaming(null);
        const value = String(next || '').trim();
        if (!value) return;
        const sessions = service(ctx, 'sessions');
        const ref = sessions && sessions.retain(id, { source: SOURCE });
        try {
          const face = ref && ref.binding && ref.binding.session;
          if (face && typeof face.rename === 'function') await face.rename(value);
        } catch (e) {
        } finally {
          try {
            if (ref && typeof ref.release === 'function') ref.release();
          } catch (e) {}
        }
        setTitles(function (prev) {
          const next = Object.assign({}, prev);
          next[id] = value;
          return next;
        });
      }

      async function archiveSession(id) {
        const ws = service(ctx, 'workspaces');
        const ui = service(ctx, 'uiWorkspace');
        try {
          if (ws && typeof ws.archiveSession === 'function') await ws.archiveSession(id, { stopActivity: true });
          else if (ui && typeof ui.archiveSession === 'function') await ui.archiveSession(id);
          else return false;
          return true;
        } catch (e) {
          return false;
        }
      }

      async function runArchive(id) {
        setMenu(null);
        // The host keeps archived sessions inside workspace.sessionIds, and the
        // tree is drawn from that list, so archived ids have to be filtered here.
        const ids = subtreeIds(loadStore(), id);
        let done = false;
        for (let i = 0; i < ids.length; i += 1) {
          const rowId = ids[i];
          const own = folderOf(loadStore(), rowId);
          const snap = {
            title: titleOf(rowId),
            dir: (own && own.dir) || '',
            group: i === 0 ? 'master' : 'child',
          };
          // Only a real host archive earns the mark. Marking a failed one both
          // hides the row and throws away its store entry, and the store entry is
          // the only thing an unarchive could have restored.
          if (await archiveSession(rowId)) {
            done = true;
            markArchived(rowId, snap);
          }
        }
        setNote(done ? L('archived') : L('archiveFailed'));
        emit();
      }

      async function runUnarchive(id) {
        setMenu(null);
        const ws = service(ctx, 'workspaces');
        const ui = service(ctx, 'uiWorkspace');
        let ok = false;
        try {
          if (ws && typeof ws.unarchiveSession === 'function') {
            await ws.unarchiveSession(id);
            ok = true;
          } else if (ui && typeof ui.unarchiveSession === 'function') {
            await ui.unarchiveSession(id);
            ok = true;
          }
        } catch (e) {
          ok = false;
        }
        // A failed restore must not clear the local mark: dropping the mark hides
        // the row from the archived list while the host still has it archived,
        // which is the worst of both states.
        if (ok) unmarkArchived(id);
        setNote(ok ? L('unarchived') : L('archiveFailed'));
        emit();
      }

      // The host exposes no workspace-level archive, so a workspace is archived
      // by archiving every session in it and hiding the empty header here.
      async function runArchiveWorkspace(wsId) {
        setMenu(null);
        const block = data.workspaces.filter(function (w) {
          return w.id === wsId;
        })[0];
        const ids = block ? block.sessionIds.slice() : [];
        Object.keys(loadStore().folders).forEach(function (nodeId) {
          const f = loadStore().folders[nodeId];
          if (f && f.ws === wsId) ids.push(nodeId);
        });
        for (let i = 0; i < ids.length; i += 1) {
          await archiveSession(ids[i]);
          unstow(ids[i]);
        }
        const s = loadStore();
        if (s.hidden.indexOf(wsId) < 0) patchStore({ hidden: s.hidden.concat([wsId]) });
        setNote(L('wsArchived'));
        emit();
      }

      // The host keeps every archived id in one registry-global set, so the
      // sessions a workspace "lost" are exactly workspace.sessionIds meeting
      // that set. Restoring them is a per-id host call; there is no bulk API.
      function archivedIdsOfWorkspace(wsId) {
        const block = data.workspaces.filter(function (w) {
          return w.id === wsId;
        })[0];
        const ids = block ? block.sessionIds.slice() : [];
        Object.keys(loadStore().folders).forEach(function (nodeId) {
          const f = loadStore().folders[nodeId];
          if (f && f.ws === wsId) ids.push(nodeId);
        });
        const out = [];
        ids.forEach(function (id) {
          if (hostArchivedIds.has(id) && out.indexOf(id) < 0) out.push(id);
        });
        return out;
      }

      async function runUnarchiveWorkspace(wsId) {
        setMenu(null);
        const ws = service(ctx, 'workspaces');
        const ui = service(ctx, 'uiWorkspace');
        const ids = archivedIdsOfWorkspace(wsId);
        let done = 0;
        for (let i = 0; i < ids.length; i += 1) {
          const id = ids[i];
          let ok = false;
          try {
            if (ws && typeof ws.unarchiveSession === 'function') {
              await ws.unarchiveSession(id);
              ok = true;
            } else if (ui && typeof ui.unarchiveSession === 'function') {
              await ui.unarchiveSession(id);
              ok = true;
            }
          } catch (e) {}
          if (ok) {
            done += 1;
            unmarkArchived(id);
          }
        }
        const st = loadStore();
        if ((st.hidden || []).indexOf(wsId) >= 0) {
          patchStore({ hidden: st.hidden.filter(function (x) { return x !== wsId; }) });
        }
        setNote(done ? L('wsUnarchived') : L('archiveFailed'));
        emit();
      }

      function runUnhide() {
        patchStore({ hidden: [] });
        setNote(L('wsRestored'));
        emit();
      }

      function unlink(id) {
        setMenu(null);
        unstow(id);
        emit();
      }

      async function submitDraft() {
        if (!draft) return;
        const name = String(draft.value || '').trim();
        if (!name) {
          setNote(L('needName'));
          return;
        }
        setBusy(true);
        setNote(null);
        const current = draft;
        try {
          const entry = await createBranch(
            ctx,
            { id: current.id || current.parentId, title: current.masterTitle },
            name,
            data,
            current
          );
          setDraft(null);
          // 'full' is the verbatim fork; only the compressed mode has a digest
          // worth reporting back.
          const modeTip =
            entry.inheritMode === 'inherit'
              ? entry.digestSource === 'failed'
                ? ' · ' + L('compressFallback')
                : ' · ' + L('inherited') + ' · ' +
                  (entry.digestSource === 'mechanical' ? L('digestMechanical') : L('digestModel')) +
                  ' ' + (entry.digestChars || 0) + L('charsUnit')
              : entry.inheritMode === 'opening'
                ? ' · ' + L('modeOpening') + ' · ' + (entry.seq == null ? 'seq?' : 'seq ' + entry.seq)
                : ' · ' + L('modeFull') + ' · ' + (entry.seq == null ? 'seq?' : 'seq ' + entry.seq);
          // An empty fork produces a perfectly valid branch row, so say it out
          // loud instead of letting the user find out on their first question.
          const emptyTip = entry.emptyFork ? ' · ' + L('emptyFork') : '';
          setNote(L('created') + ' · ' + entry.dir + modeTip + emptyTip + (entry.madeDir ? '' : ' ' + L('dirPending')));
          setCollapsed(function (prev) {
            return prev.filter(function (x) {
              return x !== current.parentId && x !== current.masterId;
            });
          });
        } catch (e) {
          setNote(String((e && e.message) || e));
        } finally {
          setBusy(false);
        }
      }

      async function startFreshSession(wsId) {
        if (sessionCreateRef.current) return false;
        sessionCreateRef.current = true;
        try {
          const id = await createFreshSession(ctx, wsId, function (openedId) {
            writeActiveId(openedId);
          });
          setNote(null);
          return id;
        } catch (e) {
          setNote(String((e && e.message) || e));
          return false;
        } finally {
          sessionCreateRef.current = false;
        }
      }

      async function newSession() {
        const wsId = (data.workspaces[0] || {}).id;
        return startFreshSession(wsId);
      }

      async function newSessionInWorkspace(wsId) {
        setWsActionMenu(null);
        return startFreshSession(wsId);
      }

      async function openFolder() {
        const ui = service(ctx, 'uiWorkspace');
        const ws = service(ctx, 'workspaces');
        try {
          const path = ui && typeof ui.pickDirectory === 'function' ? await ui.pickDirectory() : null;
          if (!path) return;
          if (ws && typeof ws.create === 'function') await ws.create({ path: path });
          else if (ui && typeof ui.connectWorkspace === 'function') await ui.connectWorkspace(path);
        } catch (e) {
          setNote(String((e && e.message) || e));
        }
        setWsMenu(false);
      }

      // Where a new branch lands: under a master session its folder is
      // `制图/<master>/<name>`; under another branch it is that branch's own
      // folder plus one more level, so the disk mirrors the tree.
      function draftFor(id, title, isBranch, node) {
        const n = node || {};
        if (isBranch) {
          return {
            id: id,
            parentId: id,
            masterId: n.masterId || id,
            masterTitle: n.masterTitle || title,
            parentDir: n.dir || null,
            value: '',
            inheritMode: 'full',
          };
        }
        // Default mode: a verbatim fork of everything the master has done so
        // far. Compression stays available as an explicit choice — it is a
        // lossy shortcut, and losing the details (a rejected approach, a spec
        // the user spelled out once) is exactly what makes a branch useless.
        return {
          id: id,
          parentId: id,
          masterId: id,
          masterTitle: title,
          parentDir: null,
          value: '',
          inheritMode: 'full',
        };
      }

      function applyNest(srcId, targetId, silent) {
        const s = loadStore();
        if (!canNest(s, srcId, targetId)) {
          if (!silent) setNote(L('nestBlocked'));
          return false;
        }
        if (!nestUnder(s, srcId, targetId, titleOf)) return false;
        saveStore(s);
        if (!silent) setNote(L('nested'));
        return true;
      }

      async function renameWorkspace(ws) {
        const svc = service(ctx, 'workspaces');
        if (!svc || typeof svc.rename !== 'function') {
          setNote(L('wsRenameUnavailable'));
          return;
        }
        let title;
        try {
          title = window.prompt(L('rename'), ws.title || '');
        } catch (e) {
          return;
        }
        if (title == null) return;
        title = String(title).trim();
        if (!title || title === ws.title) return;
        try {
          await svc.rename(ws.id, title);
          setNote(L('wsRenamed'));
        } catch (e) {
          setNote(L('wsRenameFailed') + String((e && e.message) || e));
        }
      }

      async function applyMoveToWorkspace(srcId, wsId) {
        const svc = service(ctx, 'workspaces');
        try {
          if (!svc || typeof svc.insertSessionBefore !== 'function') {
            throw new Error('workspaces.insertSessionBefore unavailable');
          }
          await svc.insertSessionBefore(wsId, srcId);
          const s = loadStore();
          if (detachEntry(s, srcId)) saveStore(s);
          setNote(L('moved'));
        } catch (e) {
          setNote(L('moveFailed') + ': ' + String((e && e.message) || e));
        }
      }

      function dragProps(id) {
        return {
          draggable: true,
          onDragStart: function (e) {
            setDrag(id);
            try {
              if (e && e.dataTransfer) {
                e.dataTransfer.setData('text/plain', id);
                e.dataTransfer.effectAllowed = 'move';
              }
            } catch (err) {}
          },
          onDragEnd: function () {
            setDrag(null);
            setDrop(null);
          },
          onDragOver: function (e) {
            if (!drag || drag === id) return;
            if (canNest(store, drag, id)) {
              if (e && typeof e.preventDefault === 'function') e.preventDefault();
              setDrop(id);
            }
          },
          onDragLeave: function () {
            if (drop === id) setDrop(null);
          },
          onDrop: function (e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            const src = drag || (e && e.dataTransfer && e.dataTransfer.getData('text/plain'));
            setDrop(null);
            setDrag(null);
            if (!src) return;
            // Plain drops intentionally do nothing; Alt-drag is the explicit
            // gesture for changing the session tree.
            if (e && e.altKey) applyNest(String(src), id, false);
          },
        };
      }

      function parentDirOf(nodeId) {
        let cur = entryOf(store, nodeId);
        for (let i = 0; i < 32 && cur; i += 1) {
          const parentId = cur.parentId || cur.masterId;
          if (!parentId || parentId === nodeId) break;
          const got = folderOf(store, parentId);
          if (got && got.dir) return got.dir;
          cur = entryOf(store, parentId);
        }
        for (let i = 0; i < data.workspaces.length; i += 1) {
          const w = data.workspaces[i];
          if ((w.sessionIds || []).indexOf(nodeId) >= 0 && w.path) return w.path;
        }
        return data.workspaces.length ? data.workspaces[0].path : null;
      }

      // Turn a folder row into a real sub-workspace: create <parent>/<name>/ and
      // a workspace rooted there, then keep the pair on the node.
      async function bindFolder(nodeId, title) {
        const ui = service(ctx, 'uiWorkspace');
        const wsApi = service(ctx, 'workspaces');
        if (!wsApi || typeof wsApi.create !== 'function') {
          setNote(L('bindUnavailable'));
          return;
        }
        const fresh = loadStore();
        const own = folderOf(fresh, nodeId);
        if (own && own.ws) {
          setNote(L('bindExists') + ' · ' + own.dir);
          return;
        }
        const parent = parentDirOf(nodeId);
        const dir = childDir(parent, title);
        try {
          if (parent && ui && typeof ui.createDirectory === 'function') {
            try {
              await ui.createDirectory(parent, sanitizeName(title) || 'sub');
            } catch (e) {}
          }
          let view;
          try {
            view = await wsApi.create({ path: dir });
          } catch (first) {
            view = await wsApi.create(dir);
          }
          const wid = view && (view.workspaceId || view.id);
          if (!wid) throw new Error('no workspace id returned');
          setFolder(fresh, nodeId, { dir: dir, ws: wid });
          saveStore(fresh);
          setNote(L('bindOk') + ' · ' + dir);
        } catch (e) {
          setNote(L('bindFailed') + ' ' + String((e && e.message) || e));
        }
      }

      function renderMenu(row) {
        if (menu !== row.id) return null;
        const items = [
          {
            key: 'open',
            label: L('open'),
            run: function () {
              openSessionSafe(ctx, row.id, acknowledge);
            },
          },
          {
            key: 'rename',
            label: L('rename'),
            run: function () {
              setRenaming(row.id);
            },
          },
          {
            key: 'branch',
            label: row.isBranch ? L('addChild') : L('addToSession'),
            run: function () {
              setDraft(draftFor(row.id, row.title, row.isBranch, row.group));
            },
          },
          {
            key: 'subws',
            label: L('bindFolder'),
            run: function () {
              bindFolder(row.id, row.title);
            },
          },
          {
            key: 'archive',
            label: L('archive'),
            run: function () {
              runArchive(row.id);
            },
          },
        ];
        if (isArchived(row.id))
          items.push({
            key: 'unarchive',
            label: L('unarchive'),
            run: function () {
              runUnarchive(row.id);
            },
          });
        if (row.isBranch)
          items.push({
            key: 'unlink',
            label: L('unlink'),
            run: function () {
              unlink(row.id);
            },
          });
        return h(
          'div',
          {
            className: 'dshbt-menu dshbt-row-menu',
            style: menuPos || {},
            onClick: function (e) { return e.stopPropagation(); },
            onMouseLeave: function () { setMenu(null); setMenuPos(null); },
          },
          items.map(function (it) {
            return h(
              'button',
              {
                key: it.key,
                type: 'button',
                className: 'dshbt-menu-item',
                onClick: function (e) {
                  e.stopPropagation();
                  setMenu(null);
                  it.run();
                },
              },
              it.label
            );
          })
        );
      }

      function renderRow(session, depth, isBranch, group) {
        const id = session.id;
        const title = titleOf(id, isBranch ? session.name : undefined);
        const kids = (group && group.children) || [];
        const level = depth + 2; // workspace=1, root conversation=2, first branch=3
        const isExpandable = kids.length > 0;
        const isLevelTwo = level === 2;
        const isLevelThree = level === 3;
        const isFolder = isLevelTwo && isExpandable;
        const isCollapsed = collapsed.indexOf(id) >= 0 && !q;
        const editing = renaming === id;
        return h(
          'div',
          {
            key: 'row-' + id,
            className:
              'dshbt-row' +
              (isFolder ? ' dshbt-folder' : '') +
              (isBranch ? ' dshbt-branch' : '') +
              (isLevelTwo ? ' dshbt-level-two' : '') +
              (isLevelThree ? ' dshbt-level-three' : '') +
              (drop === id ? ' dshbt-drop' : '') +
              (activeId === id ? ' dshbt-active' : ''),
            style: { paddingLeft: 6 + (depth + 1) * 16 },
            draggable: true,
            onDragStart: function (e) {
              dragSrc = id;
              setDrag(id);
              try {
                if (e && e.dataTransfer) {
                  e.dataTransfer.setData('text/plain', id);
                  e.dataTransfer.effectAllowed = 'move';
                }
              } catch (err) {}
            },
            onDragEnd: function () {
              dragSrc = null;
              setDrag(null);
              setDrop(null);
            },
            onDragOver: function (e) {
              const srcId = drag || dragSrc;
              if (!srcId || srcId === id) return;
              if (!canNest(store, srcId, id)) return;
              if (e && typeof e.preventDefault === 'function') e.preventDefault();
              if (e && e.dataTransfer) e.dataTransfer.dropEffect = 'move';
              if (drop !== id) setDrop(id);
            },
            onDragLeave: function () {
              if (drop === id) setDrop(null);
            },
            onDrop: function (e) {
              if (e && typeof e.preventDefault === 'function') e.preventDefault();
              if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
              let src = drag || dragSrc;
              if (!src && e && e.dataTransfer && typeof e.dataTransfer.getData === 'function') {
                src = e.dataTransfer.getData('text/plain');
              }
              setDrop(null);
              setDrag(null);
              dragSrc = null;
              if (!src) return;
              if (e && e.altKey) applyNest(String(src), id, false);
            },
            onClick: function (e) {
              if (e && e.target && e.target.closest && e.target.closest('button')) return;
              activate(id);
            },
          },
          isExpandable
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dshbt-caret' + (isCollapsed ? '' : ' open'),
                  title: isCollapsed ? L('expand') : L('collapse'),
                  onClick: function (e) {
                    e.stopPropagation();
                    toggle(id);
                  },
                },
                I('caret', 13)
              )
            : h('span', { className: 'dshbt-caret-gap' }),
          h(
            'span',
            { className: 'dshbt-glyph', style: { color: isBranch ? BRAND : MUTED } },
            I(isLevelTwo ? (isFolder ? (isCollapsed ? 'folder' : 'folderOpen') : 'chat') : isLevelThree ? 'chat' : 'branch', 14)
          ),
          editing
            ? h('input', {
                className: 'dshbt-input dshbt-inline',
                defaultValue: title,
                autoFocus: true,
                onClick: function (e) {
                  e.stopPropagation();
                },
                onKeyDown: function (e) {
                  if (e.key === 'Enter') runRename(id, e.currentTarget.value);
                  else if (e.key === 'Escape') setRenaming(null);
                },
                onBlur: function (e) {
                  runRename(id, e.currentTarget.value);
                },
              })
            : h(
                'span',
                {
                  className: 'dshbt-title',
                  title: (function () {
                    const own = folderOf(store, id);
                    return own && own.dir ? title + '\n' + own.dir : title;
                  })(),
                },
                title,
                folderOf(store, id) && folderOf(store, id).ws
                  ? h('span', { className: 'dshbt-owned' }, '⌂')
                  : null
              ),
          (function () {
            const running = !!(data.sessions.get(id) || {}).running;
            const status = running ? 'running' : taskStatuses[id];
            if (status !== 'running' && status !== 'unread') return null;
            return h('span', {
              className: 'dshbt-dot ' + (status === 'running' ? 'dshbt-dot-running' : 'dshbt-dot-unread'),
              title: L(status === 'running' ? 'taskRunning' : 'taskUnread'),
              'aria-label': L(status === 'running' ? 'taskRunning' : 'taskUnread'),
            });
          })(),
          showBranchCounts && isExpandable && depth > 0
            ? h('span', { className: 'dshbt-count' }, String(kids.length))
            : null,
          h(
            'span',
            { className: 'dshbt-actions' },
            h(IconBtn, {
              name: 'plus',
              title: isBranch ? L('addChild') : L('addToSession'),
              onClick: function () {
                const own = folderOf(store, id);
                if (own && own.ws) {
                  startFreshSession(own.ws);
                  return;
                }
                setDraft(draftFor(id, title, isBranch, group));
              },
            }),
            h(IconBtn, {
              name: 'dots',
              title: '⋯',
              onClick: function (e) {
                if (menu === id) {
                  setMenu(null);
                  setMenuPos(null);
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const count = 5 + (isArchived(id) ? 1 : 0) + (isBranch ? 1 : 0);
                setMenuPos(menuPositionForRect(rect, count, window.innerWidth || 800, window.innerHeight || 600));
                setMenu(id);
              },
            })
          ),
          renderMenu({ id: id, title: title, isBranch: isBranch, group: group })
        );
      }

      function renderDraft(nodeId) {
        if (!draft || draft.parentId !== nodeId) return null;
        const mode =
          draft.inheritMode === 'opening'
            ? 'opening'
            : draft.inheritMode === 'inherit'
              ? 'inherit'
              : 'full';
        const pick = function (next) {
          return function (e) {
            e.stopPropagation();
            setDraft(Object.assign({}, draft, { inheritMode: next }));
          };
        };
        return h(
          'div',
          { className: 'dshbt-draft', key: 'draft-' + nodeId },
          h('input', {
            className: 'dshbt-input',
            placeholder: L('namePlaceholder'),
            value: draft.value,
            autoFocus: true,
            onClick: function (e) {
              e.stopPropagation();
            },
            onChange: function (e) {
              setDraft(Object.assign({}, draft, { value: e.target.value }));
            },
            onKeyDown: function (e) {
              if (e.key === 'Enter') submitDraft();
              else if (e.key === 'Escape') setDraft(null);
            },
          }),
          h(
            'div',
            { className: 'dshbt-modes', title: L('modeLabel') },
            h('span', { className: 'dshbt-modes-label' }, L('modeLabel')),
            h(
              'button',
              {
                type: 'button',
                className: 'dshbt-mode' + (mode === 'full' ? ' is-on' : ''),
                title: L('modeFullHint'),
                onClick: pick('full'),
              },
              L('modeFull')
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshbt-mode' + (mode === 'inherit' ? ' is-on' : ''),
                title: L('modeInheritHint'),
                onClick: pick('inherit'),
              },
              L('modeInherit')
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshbt-mode' + (mode === 'opening' ? ' is-on' : ''),
                title: L('modeOpeningHint'),
                onClick: pick('opening'),
              },
              L('modeOpening')
            )
          ),
          h(
            'div',
            { className: 'dshbt-draft-btns' },
            h(
              Btn,
              { primary: true, small: true, disabled: busy, onClick: submitDraft },
              busy ? (mode === 'inherit' ? L('compressing') : L('creating')) : L('create')
            ),
            h(
              Btn,
              {
                small: true,
                onClick: function () {
                  setDraft(null);
                },
              },
              L('cancel')
            )
          )
        );
      }

      // Depth-first, so a branch holds branches the way a Zotero collection
      // holds sub-collections; `isBranch` only drives glyph and indent.
      function nodeMatches(node) {
        if (!q) return true;
        if (match(node.title) || match(node.name)) return true;
        return (node.children || []).some(nodeMatches);
      }
      function renderNodes(id, depth, isBranch) {
        if (hiddenArchived(id) || unstartedIds.indexOf(id) >= 0) return [];
        const node = groupById.get(id);
        if (node && !nodeMatches(node)) return [];
        if (!node && !match(titleOf(id))) return [];
        const kids = (node && node.children) || [];
        const visible = sortActivityIds((q ? kids.filter(nodeMatches) : kids).map(function (child) {
          return child.id;
        })).map(function (childId) {
          return groupById.get(childId);
        }).filter(Boolean);
        const isCollapsed = collapsed.indexOf(id) >= 0 && !q;
        const rows = [
          renderRow(
            { id: id, name: node && node.name },
            depth,
            isBranch,
            node
              ? {
                  children: visible,
                  masterId: node.masterId,
                  masterTitle: node.masterTitle,
                  dir: node.dir,
                }
              : undefined
          ),
          renderDraft(id),
        ];
        if (visible.length && !isCollapsed) {
          visible.forEach(function (k) {
            rows.push.apply(rows, renderNodes(k.id, depth + 1, true));
          });
        }
        const bound = folderOf(store, id);
        if (bound && bound.ws && !isCollapsed) {
          const own = data.workspaces.filter(function (x) {
            return x.id === bound.ws;
          })[0];
          sortActivityIds(((own && own.sessionIds) || []).filter(function (sid) {
            return sid !== id && !hiddenArchived(sid) && unstartedIds.indexOf(sid) < 0;
          })).forEach(function (sid) {
            rows.push(renderRow({ id: sid }, depth + 1, false, undefined));
          });
        }
        return rows;
      }
      const hostArchivedIds = useMemo(
        function () {
          const set = new Set();
          // data.archivedIds is the host's registry-global archive set, mirrored
          // by extractSnapshot. data.sessions alone is not enough: a session the
          // host hid keeps its record in the sessions snapshot without the flag.
          if (data.archivedIds && typeof data.archivedIds.forEach === 'function') {
            data.archivedIds.forEach(function (id) {
              set.add(id);
            });
          }
          data.sessions.forEach(function (v) {
            if (v && v.archived) set.add(v.id);
          });
          return set;
        },
        [data.sessions, data.archivedIds]
      );
      const hiddenArchived = function (id) {
        return isArchived(id) || hostArchivedIds.has(id);
      };
      const activityRankCache = new Map();
      const folderSessionIds = function (id) {
        const bound = folderOf(store, id);
        if (!bound || !bound.ws) return [];
        const own = data.workspaces.filter(function (x) { return x.id === bound.ws; })[0];
        return ((own && own.sessionIds) || []).filter(function (sid) { return sid !== id; });
      };
      const activityVisible = function (id) {
        if (hiddenArchived(id) || unstartedIds.indexOf(id) >= 0) return false;
        if (!q) return true;
        const node = groupById.get(id);
        return node ? nodeMatches(node) : match(titleOf(id));
      };
      const sortActivityIds = function (ids) {
        return sortBySubtreeActivity(
          ids, groupById, data.sessions, folderSessionIds, activityVisible, activityRankCache
        );
      };
      const boundWs = boundWorkspaceIds(store);
      const storeHidden = loadStore().hidden || [];
      // v19: the archive section. The host removes archived sessions from the
      // sidebar snapshot, so the rows come from our own archive box; the search
      // box filters them too, and each row restores through the host API.
      const arcKeys = 'arc:';
      const arcCollapsed = collapsed.indexOf(arcKeys) >= 0 && !q;
      const arcEntries = Object.keys(store.archiveBox || {})
        .map(function (k) {
          return store.archiveBox[k];
        })
        .filter(function (e) {
          return !!(e && e.id);
        })
        .filter(function (e) {
          return !q || match(e.title || '') || match(e.dir || '') || e.id.indexOf(q) >= 0;
        })
        .sort(function (a, b) {
          return (b.at || 0) - (a.at || 0);
        });
      const archiveBlock = arcEntries.length
        ? h(
            'div',
            { className: 'dshbt-ws dshbt-arc', key: 'archive' },
            h(
              'div',
              { className: 'dshbt-ws-head' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshbt-ws-caret' + (arcCollapsed ? '' : ' open'),
                  title: arcCollapsed ? L('expand') : L('collapse'),
                  onClick: function (e) {
                    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                    toggle(arcKeys);
                  },
                },
                I('caret', 12)
              ),
              h(
                'span',
                {
                  className: 'dshbt-ws-title',
                  style: { cursor: 'pointer' },
                  onClick: function () {
                    toggle(arcKeys);
                  },
                },
                L('archivedHeader')
              ),
              h('span', { className: 'dshbt-count' }, String(arcEntries.length))
            ),
            arcCollapsed
              ? null
              : arcEntries.map(function (e) {
                  return h(
                    'div',
                    {
                      key: 'arc-' + e.id,
                      className: 'dshbt-arcrow',
                      title: (e.title || e.id) + '\n' + (e.dir || '') + '\n' + L('restoreHint'),
                      onClick: function () {
                        openSessionSafe(ctx, e.id, acknowledge);
                      },
                    },
                    I('chat', 13),
                    h('span', { className: 'dshbt-title' }, e.title || sessionLabel(e.id)),
                    h('span', { className: 'dshbt-arcmeta' }, agoText(e.at)),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshbt-iconbtn',
                        title: L('unarchive'),
                        onClick: function (ev) {
                          if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
                          runUnarchive(e.id);
                        },
                      },
                      I('undo', 12)
                    )
                  );
                })
          )
        : null;

      const workspaceBlocks = data.workspaces
        .filter(function (ws) {
          return !boundWs.has(ws.id) && storeHidden.indexOf(ws.id) < 0;
        })
        .map(function (ws) {
          const top = sortActivityIds(ws.sessionIds.filter(function (id) {
            return !branchIds.has(id) && !hiddenArchived(id) && unstartedIds.indexOf(id) < 0;
          }));
          const rows = [];
          const wsKey = 'ws:' + ws.id;
          const wsCollapsed = collapsed.indexOf(wsKey) >= 0 && !q;
          top.forEach(function (id) {
            rows.push.apply(rows, renderNodes(id, 0, false));
          });
          return h(
            'div',
            { className: 'dshbt-ws', key: ws.id },
            true
              ? h(
                  'div',
                  {
                    className: 'dshbt-ws-head' + (drop === 'ws:' + ws.id ? ' dshbt-drop' : ''),
                    title: (ws.path || ws.title) + ' · ' + L('dragHint'),
                    onDragOver: function (e) {
                      if (!drag && !dragSrc) return;
                      if (e && typeof e.preventDefault === 'function') e.preventDefault();
                      setDrop('ws:' + ws.id);
                    },
                    onDragLeave: function () {
                      if (drop === 'ws:' + ws.id) setDrop(null);
                    },
                    onDrop: function (e) {
                      if (e && typeof e.preventDefault === 'function') e.preventDefault();
                      const src = drag || (e && e.dataTransfer && e.dataTransfer.getData('text/plain'));
                      setDrop(null);
                      setDrag(null);
                      dragSrc = null;
                      if (src) applyMoveToWorkspace(String(src), ws.id);
                    },
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshbt-ws-caret' + (wsCollapsed ? '' : ' open'),
                      title: wsCollapsed ? L('expand') : L('collapse'),
                      onClick: function (e) {
                        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                        toggle(wsKey);
                      },
                    },
                    I('caret', 12)
                  ),
                  h('span', { className: 'dshbt-glyph', style: { color: MUTED } }, I(wsCollapsed ? 'folder' : 'folderOpen', 14)),
                  h(
                    'span',
                    {
                      className: 'dshbt-ws-title',
                      style: { cursor: 'pointer' },
                      onClick: function (e) {
                        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                        toggle(wsKey);
                      },
                    },
                    ws.title
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshbt-iconbtn',
                      title: L('archiveWs'),
                      onClick: function (e) {
                        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                        setWsActionMenu(wsActionMenu === ws.id ? null : ws.id);
                      },
                    },
                    I('dots', 12)
                  ),
                  wsActionMenu === ws.id
                    ? h(
                        'div',
                        {
                          className: 'dshbt-menu dshbt-menu-ws',
                          onClick: function (e) { return e.stopPropagation(); },
                          onMouseLeave: function () { setWsActionMenu(null); },
                        },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dshbt-menu-item',
                            onClick: function () {
                              setWsActionMenu(null);
                              newSessionInWorkspace(ws.id);
                            },
                          },
                          L('newSession')
                        ),
                        h('div', { className: 'dshbt-menu-sep' }),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dshbt-menu-item',
                            onClick: function () {
                              setWsActionMenu(null);
                              if (window.confirm(L('archiveWsConfirm') + '\n' + ws.title)) {
                                runArchiveWorkspace(ws.id);
                              }
                            },
                          },
                          L('archiveWs')
                        ),
                        archivedIdsOfWorkspace(ws.id).length
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'dshbt-menu-item',
                                onClick: function () {
                                  setWsActionMenu(null);
                                  if (window.confirm(L('unarchiveWsConfirm') + '\n' + ws.title)) {
                                    runUnarchiveWorkspace(ws.id);
                                  }
                                },
                              },
                              L('unarchiveWs') + ' (' + archivedIdsOfWorkspace(ws.id).length + ')'
                            )
                          : null
                      )
                    : null
                )
              : null,
            wsCollapsed ? null : rows
          );
        })
        .filter(Boolean);

      // Cascade renderer: workspace -> root sessions -> recursively nested branches.
      // Each trigger only expands its own children; leaves open their exact session id.
      function cascadeSessionNode(id, parentPath) {
        if (hiddenArchived(id) || unstartedIds.indexOf(id) >= 0) return null;
        const node = groupById.get(id);
        const kids = (node && node.children) || [];
        const cascadeTitle = node && node.name ? node.name : titleOf(id);
        const key = 'session:' + id;
        const path = (parentPath || []).concat(key);
        const open = cascadePath.length >= path.length && path.every(function (part, i) { return cascadePath[i] === part; });
        const branchCount = showBranchCounts && node && node.count > 0
          ? h('span', { className: 'dshbt-cascade-count' }, String(node.count))
          : null;
        const children = sortActivityIds(kids.map(function (child) { return child.id; }))
          .map(function (childId) { return cascadeSessionNode(childId, path); })
          .filter(Boolean);
        return h(
          'div',
          { key: key, className: 'dshbt-cascade-entry' },
          h(
            'button',
            {
              type: 'button', role: 'menuitem',
              className: 'dshbt-menu-item dshbt-cascade-trigger' + (open ? ' dshbt-cascade-active' : ''),
              'aria-label': cascadeTitle, 'aria-haspopup': children.length ? 'menu' : undefined,
              'aria-expanded': children.length ? !!open : undefined,
              onClick: function () {
                if (children.length) setCascadeOpen(open ? (parentPath || []) : path);
                else { setWsMenu(false); setCascadeOpen([]); openSessionSafe(ctx, id, acknowledge); }
              },
            },
            h('span', { className: 'dshbt-cascade-label' }, cascadeTitle),
            branchCount,
            children.length ? I('caret', 12) : null
          ),
          children.length && open
            ? h('div', { className: 'dshbt-cascade-submenu', role: 'menu' }, children)
            : null
        );
      }

      const diagText = function () {
        try {
          const raw = data.raw;
          const keys = raw && typeof raw === 'object' ? Object.keys(raw) : [];
          let sample = String(raw);
          try {
            sample = JSON.stringify(raw, function (k, v) {
              return typeof v === 'function' ? '[fn]' : v;
            });
          } catch (e) {}
          return JSON.stringify({ keys: keys, sample: String(sample).slice(0, 4000) }, null, 2);
        } catch (e) {
          return String(e && e.message);
        }
      };

      return h(
        'div',
        { className: 'dshbt-treebody' },
        h(
          'div',
          { className: 'dshbt-wsbar' },
          h(
            'button',
            {
              type: 'button',
              className: 'dshbt-wsw',
              onClick: function (e) {
                e.stopPropagation();
                setWsMenu(!wsMenu);
              },
            },
            h('span', { className: 'dshbt-ws-name' }, L('allChats')),
            I('caret', 12)
          ),
          h(IconBtn, { name: 'plus', title: L('newSession'), onClick: newSession }),
          h(
            'button',
            {
              type: 'button',
              className: 'dshbt-count-switch',
              role: 'switch',
              'aria-checked': !!showBranchCounts,
              'aria-label': L('branchCounts'),
              title: L('branchCounts'),
              onClick: function () {
                const next = !showBranchCounts;
                writeJSON(SHOW_BRANCH_COUNTS_KEY, next);
                setShowBranchCounts(next);
              },
            },
            h('span', { className: 'dshbt-count-switch-knob' }),
            h('span', { className: 'dshbt-count-switch-label' }, L('branchCounts'))
          ),
          wsMenu
            ? h(
                'div',
                {
                  className: 'dshbt-menu dshbt-menu-ws dshbt-cascade-menu',
                  role: 'menu',
                  onClick: function (e) {
                    return e.stopPropagation();
                  },
                  onKeyDown: function (e) {
                    if (e && e.key === 'Escape') {
                      setWsMenu(false);
                      setCascadeOpen([]);
                    }
                  },
                  onMouseLeave: function () {
                    setWsMenu(false);
                    setCascadeOpen([]);
                  },
                },
                data.workspaces.filter(function (ws) {
                  return !boundWs.has(ws.id) && storeHidden.indexOf(ws.id) < 0;
                }).map(function (ws) {
                  const rootIds = sortActivityIds(ws.sessionIds.filter(function (id) {
                    return !branchIds.has(id) && !hiddenArchived(id) && unstartedIds.indexOf(id) < 0;
                  }));
                  const wsPath = ['ws:' + ws.id];
                  const wsOpen = cascadePath.length > 0 && cascadePath[0] === wsPath[0];
                  return h(
                    'div',
                    {
                      key: ws.id,
                      className: 'dshbt-cascade-entry dshbt-cascade-workspace-entry',
                    },
                    h(
                      'button',
                      {
                        type: 'button',
                        role: 'menuitem',
                        className: 'dshbt-menu-item dshbt-cascade-trigger' + (wsOpen ? ' dshbt-cascade-active' : ''),
                        'aria-label': ws.title,
                        'aria-haspopup': 'menu',
                        'aria-expanded': !!wsOpen,
                        onClick: function () {
                          setCascadeOpen(wsOpen ? [] : wsPath);
                        },
                      },
                      h('span', { className: 'dshbt-cascade-label' }, ws.title),
                      I('caret', 12)
                    ),
                    wsOpen
                      ? h(
                          'div',
                          { className: 'dshbt-cascade-submenu', role: 'menu' },
                          rootIds.length
                            ? rootIds.map(function (id) { return cascadeSessionNode(id, wsPath); })
                            : h('div', { className: 'dshbt-cascade-empty' }, L('noChats'))
                        )
                      : null
                  );
                }),
                h('div', { className: 'dshbt-menu-sep' }),
                h('button', { type: 'button', className: 'dshbt-menu-item', onClick: function () { setWsMenu(false); openFolder(); } }, L('openFolder'))
              )
            : null
        ),
        h(
          'div',
          { className: 'dshbt-searchrow' },
          I('search', 13),
          h('input', {
            className: 'dshbt-search',
            placeholder: L('search'),
            value: query,
            onChange: function (e) {
              setQuery(e.target.value);
            },
            onClick: function (e) {
              e.stopPropagation();
            },
          })
        ),
        note
          ? h(
              'div',
              { className: 'dshbt-note' },
              note,
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshbt-note-x',
                  onClick: function () {
                    setNote(null);
                  },
                },
                '×'
              )
            )
          : null,
        !data.workspaces.length
          ? h(
              'div',
              { className: 'dshbt-diag' },
              h('div', { className: 'dshbt-diag-title' }, L('diag')),
              h('div', { className: 'dshbt-diag-hint' }, L('diagHint')),
              h('textarea', { className: 'dshbt-diag-text', readOnly: true, value: diagText() })
            )
          : null,
        h('div', { className: 'dshbt-rows' }, workspaceBlocks, archiveBlock),
        storeHidden.length
          ? h(
              'button',
              {
                type: 'button',
                className: 'dshbt-restore',
                title: L('restoreWs'),
                onClick: runUnhide,
              },
              L('restoreWs') + ' (' + storeHidden.length + ')'
            )
          : null,
        h(
          'div',
          { className: 'dshbt-foot' },
          h(
            'button',
            { type: 'button', className: 'dshbt-foot-btn', onClick: newSession },
            I('plus', 13),
            h('span', null, L('newSession')),
            h('span', { className: 'dshbt-ver' }, VERSION)
          )
        ),
      );
    }

    // ------------------------------------------------------- sidebar browser
    // v4: never bail out on `wide`. The host mounts this slot in more than one
    // mode, and returning null in one of them blanked the whole left column,
    // because shadowing the shipped seat removes the native list for good.
    // Always render something, and if rendering throws show the reason instead
    // of an empty void.
    const VERSION = 'v52';

    class SlotBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { err: null };
      }
      static getDerivedStateFromError(err) {
        return { err: err };
      }
      componentDidCatch(err) {
        console.warn('[branch-tree] sidebar render failed:', err && (err.stack || err.message || err));
        // Self-healing: a render failure records which build failed and turns
        // the takeover off for it, so a reload shows the shipped list again.
        // A newer build is allowed one more attempt (see takeoverEnabled).
        writeJSON(TAKEOVER_KEY, { mode: 'auto-off', version: VERSION });
      }
      render() {
        if (this.state.err) {
          const msg = String((this.state.err && (this.state.err.stack || this.state.err.message)) || this.state.err);
          return h(
            'div',
            { className: 'dshbt-sb' },
            h(
              'div',
              { className: 'dshbt-diag' },
              h('div', { className: 'dshbt-diag-title' }, L('diag') + ' · ' + VERSION),
              h('div', { className: 'dshbt-diag-hint' }, L('diagHint')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshbt-foot-btn',
                  onClick: function () {
                    writeJSON(TAKEOVER_KEY, { mode: 'off' });
                    try {
                      window.location.reload();
                    } catch (e) {}
                  },
                },
                L('restore')
              ),
              h('textarea', { className: 'dshbt-diag-text', readOnly: true, value: msg })
            )
          );
        }
        return this.props.children;
      }
    }

    function BrowserInner(props) {
      const data = useHostData(props || {});
      const narrow = !!(props && props.wide === false);
      return h(
        'div',
        { className: 'dshbt-sb' + (narrow ? ' dshbt-narrow' : '') },
        h(TreeBody, { ctx: ctxRef.ref, data: data })
      );
    }

    // The key carries the available hook set: when the host changes which
    // selector hooks it passes, React mounts a fresh instance instead of
    // re-rendering this one with a different hook count (React #310).
    function WorkspaceBrowser(props) {
      return h(
        SlotBoundary,
        null,
        h(BrowserInner, Object.assign({}, props, { key: 'side:' + hookKey(props) }))
      );
    }

    // ------------------------------------------------------------- main panel
    function PanelIcon(props) {
      const size = (props && props.size) || 16;
      const active = props && props.active;
      return h(
        'span',
        { className: 'dshbt-panicon' + (active ? ' active' : ''), style: { width: size, height: size } },
        icon(ICONS.branch, size)
      );
    }

    function PanelInner(props) {
      const data = useHostData(props || {});
      return h(
        'div',
        { className: 'dshbt-panel' },
        h(
          'div',
          { className: 'dshbt-panel-head' },
          h('div', { className: 'dshbt-panel-title' }, I('branch', 16), L('title')),
          h('div', { className: 'dshbt-panel-sub' }, L('subtitle'))
        ),
        h(
          'div',
          { className: 'dshbt-panel-body' },
          h(TreeBody, { ctx: ctxRef.ref, data: data }),
          h(
            'div',
            { className: 'dshbt-panel-foot' },
            h('span', null, L('panelHint')),
            h(
              'button',
              {
                type: 'button',
                className: 'dshbt-foot-btn',
                onClick: function () {
                  const raw = data.raw || {};
                  const sketch = {};
                  Object.keys(raw).forEach(function (k) {
                    sketch[k] = shapeOf(raw[k], 0);
                  });
                  const sessions = {};
                  data.sessions.forEach(function (v, k) {
                    sessions[k] = v.title || null;
                  });
                  const report = {
                    version: VERSION,
                    injectedProps: propKeysOf(props),
                    titleCount: data.sessions.size,
                    titledCount: Array.from(data.sessions.values()).filter(function (s) {
                      return !!s.title;
                    }).length,
                    sessions: sessions,
                    workspaces: (data.workspaces || []).map(function (w) {
                      return { title: w.title, path: w.path, sessions: (w.sessionIds || []).length };
                    }),
                    shape: sketch,
                  };
                  copyText(JSON.stringify(report, null, 2));
                },
              },
              L('copyShape')
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshbt-foot-btn',
                onClick: function () {
                  const on = takeoverEnabled();
                  writeJSON(TAKEOVER_KEY, { mode: on ? 'off' : 'on' });
                  try {
                    window.location.reload();
                  } catch (e) {}
                },
              },
              takeoverEnabled() ? L('takeoverOff') : L('takeoverOn')
            )
          )
        )
      );
    }

    // ------------------------------------------------------------------- CSS
    const CSS = [
      '.dshbt-sb{position:relative;display:flex;flex-direction:column;min-height:0;height:100%;background:transparent;color:' + COLOR + ';}',
      '.dshbt-treebody{display:flex;flex-direction:column;min-height:0;flex:1;}',
      '.dshbt-wsbar{display:flex;align-items:center;gap:4px;padding:2px 6px 2px 8px;position:relative;}',
      '.dshbt-count-switch{display:inline-flex;align-items:center;gap:4px;flex:none;border:0;background:none;padding:3px;color:' + MUTED + ';font:inherit;font-size:10px;cursor:pointer;border-radius:6px;}',
      '.dshbt-count-switch:hover{background:' + HOVER + ';color:' + COLOR + ';}',
      '.dshbt-count-switch-knob{width:22px;height:12px;border-radius:8px;background:' + BORDER_2 + ';position:relative;transition:background .15s ease;}',
      '.dshbt-count-switch-knob:after{content:"";position:absolute;top:2px;left:2px;width:8px;height:8px;border-radius:50%;background:#fff;transition:transform .15s ease;}',
      '.dshbt-count-switch[aria-checked="true"] .dshbt-count-switch-knob{background:' + BRAND + ';}',
      '.dshbt-count-switch[aria-checked="true"] .dshbt-count-switch-knob:after{transform:translateX(10px);}',
      '.dshbt-wsw{display:flex;align-items:center;gap:4px;flex:1;min-width:0;background:none;border:0;padding:4px 2px;cursor:pointer;color:' + MUTED + ';font:inherit;font-size:13px;font-weight:600;border-radius:6px;text-align:left;}',
      '.dshbt-wsw:hover{background:' + HOVER + ';color:' + COLOR + ';}',
      '.dshbt-ws-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshbt-searchrow{display:flex;align-items:center;gap:6px;margin:2px 8px 6px;padding:0 8px;height:28px;border:1px solid ' + BORDER + ';border-radius:8px;background:transparent;color:' + MUTED + ';}',
      '.dshbt-search{flex:1;min-width:0;border:0;outline:0;background:transparent;color:' + COLOR + ';font:inherit;font-size:12.5px;}',
      '.dshbt-rows{flex:1;min-height:0;overflow-y:auto;padding:2px 6px 8px;}',
      '.dshbt-ws{margin-bottom:4px;}',
      '.dshbt-restore{display:flex;align-items:center;justify-content:center;margin:6px 8px 0;padding:5px 8px;border:1px dashed ' + BORDER + ';border-radius:7px;background:transparent;color:' + MUTED + ';font-size:11px;cursor:pointer;}',
      '.dshbt-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:none;border-radius:5px;background:transparent;color:inherit;opacity:.55;cursor:pointer;}',
      '.dshbt-iconbtn:hover{opacity:1;background:rgba(36,123,191,.10);}',
      '.dshbt-ws-head{position:relative;display:flex;align-items:center;gap:4px;padding:6px 8px 2px;color:' + MUTED + ';font-size:13px;font-weight:700;}',
      '.dshbt-ws-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshbt-ws-caret{width:14px;height:14px;flex:none;display:flex;align-items:center;justify-content:center;border:0;background:none;padding:0;color:' + MUTED + ';cursor:pointer;transition:transform .12s ease;}',
      '.dshbt-ws-caret.open{transform:rotate(90deg);}',
      '.dshbt-ws-caret:hover{color:' + COLOR + ';}',
      '.dshbt-arc{margin-top:6px;border-top:1px solid ' + BORDER + ';padding-top:4px;}',
      '.dshbt-arc .dshbt-ws-head{color:' + WARN + ';}',
      '.dshbt-arcrow{display:flex;align-items:center;gap:6px;height:28px;padding:0 6px 0 14px;border-radius:7px;color:' + MUTED + ';font-size:12.5px;cursor:pointer;}',
      '.dshbt-arcrow:hover{background:' + HOVER + ';color:' + COLOR + ';}',
      '.dshbt-arcrow>.dshbt-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshbt-arcmeta{flex:none;font-size:10.5px;color:' + MUTED + ';opacity:.75;}',
      '.dshbt-row{position:relative;display:flex;align-items:center;gap:6px;height:30px;padding-right:6px;border-radius:7px;cursor:grab;-webkit-user-drag:element;color:' + COLOR + ';font-size:13px;}',
      '.dshbt-row:active{cursor:grabbing;}',
      '.dshbt-row:hover{background:' + HOVER + ';}',
      '.dshbt-row.dshbt-active{background:rgba(0,0,0,.5);color:#fff;}',
      '.dshbt-row.dshbt-active:hover{background:rgba(0,0,0,.5);}',
      '.dshbt-row.dshbt-active>.dshbt-title{color:#fff;font-weight:700;}',
      '.dshbt-row.dshbt-active>.dshbt-glyph{color:#fff!important;}',
      '.dshbt-row.dshbt-active>.dshbt-count{background:rgba(255,255,255,.22);color:#fff;}',
      '.dshbt-row.dshbt-active .dshbt-owned{color:#fff;}',
      '.dshbt-row.dshbt-active .dshbt-caret{color:#fff;}',
      '.dshbt-row.dshbt-folder>.dshbt-title{font-weight:600;}',
      '.dshbt-caret{width:16px;height:16px;flex:none;display:flex;align-items:center;justify-content:center;border:0;background:none;padding:0;color:' + MUTED + ';cursor:pointer;transition:transform .12s ease;}',
      '.dshbt-caret.open{transform:rotate(90deg);}',
      '.dshbt-caret:hover{color:' + COLOR + ';}',
      '.dshbt-caret-gap{width:16px;flex:none;}',
      '.dshbt-glyph{display:flex;align-items:center;flex:none;}',
      '.dshbt-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshbt-owned{color:' + BRAND + ';font-size:11px;margin-left:4px;opacity:.9;}',
      '.dshbt-count{margin-left:2px;padding:0 6px;height:16px;line-height:16px;border-radius:8px;background:' + LAYER_2 + ';color:' + MUTED + ';font-size:11px;font-weight:600;}',
      '.dshbt-dot{width:8px;height:8px;border-radius:50%;flex:none;}',
      '.dshbt-dot-running{background:#eab308;animation:dshbt-status-pulse 1.1s ease-in-out infinite;}',
      '.dshbt-dot-unread{background:#22c55e;}',
      '@keyframes dshbt-status-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(234,179,8,.3);}50%{opacity:.38;box-shadow:0 0 0 4px rgba(234,179,8,0);}}',
      '@media (prefers-reduced-motion: reduce){.dshbt-dot-running{animation:none;}}',
      '.dshbt-actions{display:none;align-items:center;gap:2px;flex:none;}',
      '.dshbt-row:hover .dshbt-actions{display:flex;}',
      '.dshbt-row.dshbt-drop{box-shadow:inset 0 0 0 1.5px ' + BRAND + ';background:rgba(36,123,191,.10);}',
      '.dshbt-ws-head.dshbt-drop{box-shadow:inset 0 0 0 1.5px ' + BRAND + ';border-radius:6px;background:rgba(36,123,191,.10);}',
      '.dshbt-icon-btn{width:22px;height:22px;display:flex;align-items:center;justify-content:center;border:0;background:none;padding:0;border-radius:5px;color:' + MUTED + ';cursor:pointer;}',
      '.dshbt-icon-btn:hover{background:' + BORDER + ';color:' + COLOR + ';}',
      '.dshbt-menu{position:absolute;top:100%;right:6px;z-index:5;min-width:150px;padding:4px;border:1px solid ' + BORDER_2 + ';border-radius:9px;background:' + LAYER_1 + ';box-shadow:0 8px 24px rgba(0,0,0,.14);}',
      '.dshbt-row-menu{position:fixed;top:auto;right:auto;bottom:auto;z-index:1;box-sizing:border-box;max-width:calc(100vw - 16px);overflow-y:auto;overscroll-behavior:contain;}',
      '.dshbt-menu-ws{top:26px;right:8px;left:8px;min-width:0;z-index:5;}',
      '.dshbt-cascade-menu{box-sizing:border-box;max-height:min(70vh,560px);overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;}',
      '.dshbt-cascade-entry{position:relative;}',
      '.dshbt-cascade-workspace-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:2px;}',
      '.dshbt-cascade-workspace-entry>.dshbt-cascade-trigger{grid-column:1;grid-row:1;min-width:0;}',
      '.dshbt-cascade-workspace-entry>.dshbt-cascade-submenu{grid-column:1 / -1;}',
      '.dshbt-menu-item.dshbt-cascade-trigger{display:flex;align-items:center;gap:8px;min-height:30px;box-sizing:border-box;}',
      '.dshbt-cascade-trigger:focus-visible{outline:2px solid ' + BRAND + ';outline-offset:-2px;}',
      '.dshbt-cascade-active{background:' + LAYER_2 + ';}',
      '.dshbt-cascade-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshbt-cascade-count{flex:none;color:' + MUTED + ';font-size:11px;}',
      '.dshbt-cascade-submenu{position:static;box-sizing:border-box;min-width:0;max-width:100%;margin:2px 0 4px 10px;padding:2px 0 2px 8px;border:0;border-left:1px solid ' + BORDER_2 + ';border-radius:0;background:transparent;box-shadow:none;}',
      '.dshbt-cascade-empty{padding:8px 10px;color:' + MUTED + ';font-size:12px;}',
      '.dshbt-menu-item{display:block;width:100%;text-align:left;border:0;background:none;padding:7px 9px;border-radius:6px;color:' + COLOR + ';font:inherit;font-size:12.5px;cursor:pointer;}',
      '.dshbt-menu-item:hover{background:' + LAYER_2 + ';}',
      '.dshbt-menu-sep{height:1px;margin:4px 2px;background:' + BORDER + ';}',
      '.dshbt-draft{margin:2px 0 4px;padding:6px 8px 6px 26px;border-radius:8px;background:' + LAYER_2 + ';}',
      '.dshbt-input{width:100%;box-sizing:border-box;height:28px;padding:0 8px;border:1px solid ' + BORDER_2 + ';border-radius:7px;background:' + LAYER_1 + ';color:' + COLOR + ';font:inherit;font-size:12.5px;outline:0;}',
      '.dshbt-input:focus{border-color:' + BRAND + ';}',
      '.dshbt-input.dshbt-inline{height:24px;padding:0 6px;flex:1;}',
      '.dshbt-draft-btns{display:flex;gap:6px;margin-top:6px;justify-content:flex-end;}',
      '.dshbt-modes{display:flex;align-items:center;gap:3px;margin-top:6px;flex-wrap:nowrap;overflow:hidden;}',
      '.dshbt-modes-label{flex:none;font-size:9.5px;opacity:.58;margin-right:1px;white-space:nowrap;}',
      '.dshbt-mode{flex:none;height:17px;padding:0 4px;border:1px solid ' + BORDER_2 + ';border-radius:5px;background:' + LAYER_1 + ';color:' + COLOR + ';font:inherit;font-size:9.5px;line-height:15px;white-space:nowrap;cursor:pointer;opacity:.78;}',
      '.dshbt-mode:hover{background:' + LAYER_2 + ';opacity:1;}',
      '.dshbt-mode.is-on{border-color:' + BRAND + ';color:' + BRAND + ';background:' + LAYER_2 + ';opacity:1;font-weight:600;}',
      '.dshbt-btn{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 12px;border:1px solid ' + BORDER_2 + ';border-radius:8px;background:' + LAYER_1 + ';color:' + COLOR + ';font:inherit;font-size:12.5px;cursor:pointer;}',
      '.dshbt-btn:hover{background:' + LAYER_2 + ';}',
      '.dshbt-btn-sm{height:24px;padding:0 9px;font-size:12px;}',
      '.dshbt-btn-primary{border-color:' + BRAND + ';background:' + BRAND + ';color:#fff;}',
      '.dshbt-btn-primary:hover{filter:brightness(1.06);background:' + BRAND + ';}',
      '.dshbt-btn:disabled{opacity:.55;cursor:default;}',
      '.dshbt-note{display:flex;align-items:center;gap:6px;margin:0 8px 6px;padding:5px 8px;border-radius:7px;background:' + LAYER_2 + ';color:' + WARN + ';font-size:11.5px;}',
      '.dshbt-note-x{margin-left:auto;border:0;background:none;color:' + MUTED + ';cursor:pointer;font-size:13px;line-height:1;}',
      '.dshbt-diag{margin:0 8px 8px;padding:8px;border:1px dashed ' + BORDER_2 + ';border-radius:8px;background:' + LAYER_1 + ';}',
      '.dshbt-diag-title{font-size:11.5px;font-weight:700;color:' + WARN + ';}',
      '.dshbt-diag-hint{margin-top:3px;font-size:11px;color:' + MUTED + ';line-height:1.4;}',
      '.dshbt-diag-text{margin-top:6px;width:100%;box-sizing:border-box;height:120px;border:1px solid ' + BORDER + ';border-radius:6px;background:' + LAYER_2 + ';color:' + MUTED + ';font-family:ui-monospace,Menlo,monospace;font-size:10.5px;padding:6px;resize:vertical;}',
      '.dshbt-empty{padding:10px;color:' + MUTED + ';font-size:12px;}',
      '.dshbt-foot{padding:6px 8px 8px;border-top:1px solid ' + BORDER + ';}',
      '.dshbt-foot-btn{display:flex;align-items:center;gap:6px;width:100%;height:30px;padding:0 8px;border:0;border-radius:7px;background:none;color:' + MUTED + ';font:inherit;font-size:12.5px;cursor:pointer;}',
      '.dshbt-foot-btn:hover{background:' + HOVER + ';color:' + COLOR + ';}',
      '.dshbt-ver{margin-left:auto;font-size:10px;opacity:.45;}',
      '.dshbt-narrow .dshbt-wsbar,.dshbt-narrow .dshbt-searchrow,.dshbt-narrow .dshbt-foot{display:none;}',
      '.dshbt-panel{display:flex;flex-direction:column;height:100%;min-height:0;background:' + LAYER_1 + ';color:' + COLOR + ';}',
      '.dshbt-panel-head{padding:18px 20px 12px;border-bottom:1px solid ' + BORDER + ';}',
      '.dshbt-panel-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:650;color:' + COLOR + ';}',
      '.dshbt-panel-sub{margin-top:6px;max-width:760px;font-size:12.5px;line-height:1.55;color:' + MUTED + ';}',
      '.dshbt-panel-body{flex:1;min-height:0;display:flex;flex-direction:column;max-width:760px;width:100%;}',
      '.dshbt-panel-body>.dshbt-treebody{padding:8px 10px 0;}',
      '.dshbt-panel-foot{padding:10px 20px 16px;color:' + MUTED + ';font-size:11.5px;}',
      '.dshbt-panicon{display:flex;align-items:center;justify-content:center;color:inherit;opacity:.9;}',
      '.dshbt-panicon.active{color:' + BRAND + ';opacity:1;}',
    ].join('\n');

    function insertStyles(css) {
      let done = false;
      try {
        if (typeof styles !== 'undefined' && styles && typeof styles.insert === 'function') {
          styles.insert(css);
          done = true;
        }
      } catch (e) {}
      if (done) return;
      try {
        const doc = document;
        if (!doc) return;
        const el = doc.createElement('style');
        el.id = 'dshbt-style';
        el.textContent = css;
        (doc.head || doc.documentElement).appendChild(el);
      } catch (e) {}
    }

    // ------------------------------------------------------------------ apply
    const ctxRef = { ref: undefined };

    function Panel(props) {
      return h(
        SlotBoundary,
        null,
        h(PanelInner, Object.assign({}, props, { key: 'panel:' + hookKey(props) }))
      );
    }

    // A single slot renders the LOWEST priority. The shipped browser claims
    // priorities 0 and 1, so shadowing it means going below both — and any
    // collision throws, which used to kill the whole client module (no UI at
    // all). Try a descending list and never let the failure escape.
    const SHADOW_PRIORITIES = [-1, -10, -100, -1000];

    function shadowRegister(ctx, name, Comp) {
      let last;
      for (let i = 0; i < SHADOW_PRIORITIES.length; i += 1) {
        try {
          return ctx.slots.register({ name: name, priority: SHADOW_PRIORITIES[i] }, Comp);
        } catch (e) {
          last = e;
          console.warn('[branch-tree] shadow register rejected at priority', SHADOW_PRIORITIES[i], e && e.message);
        }
      }
      throw last;
    }

    function injectSlot(ctx, name, register) {
      try {
        ctx.slots.inject(name, register);
      } catch (e) {
        console.warn('[branch-tree] slot not available:', name, e && e.message);
      }
    }

    return {
      inject: ['slots', 'remote', 'remote.session', 'remote.workspaceFiles'],
      apply(ctx) {
        ctxRef.ref = ctx;
        insertStyles(CSS);
        // v6: the tree is drawn in the shipped sidebar seat so branches nest
        // under the real session rows the way Zotero nests collections. That
        // seat is opt-out: the keyed hook set above prevents React #310, and a
        // render failure writes 'off' so the next load never crashes twice.
        if (takeoverEnabled()) {
          injectSlot(ctx, 'sidebar.workspaces', function () {
            try {
              return shadowRegister(ctx, 'sidebar.workspaces', WorkspaceBrowser);
            } catch (e) {
              console.warn('[branch-tree] cannot take over the sidebar:', e && e.message);
              return undefined;
            }
          });
        }
        injectSlot(ctx, 'sidebar.panellist', function () {
          try {
            return ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_KEY, order: 20, label: L('panelLabel') },
              PanelIcon
            );
          } catch (e) {
            console.warn('[branch-tree] panellist seat failed:', e && e.message);
            return undefined;
          }
        });
        injectSlot(ctx, 'main', function () {
          try {
            return ctx.slots.register({ name: 'main', key: PANEL_KEY }, Panel);
          } catch (e) {
            console.warn('[branch-tree] main panel seat failed:', e && e.message);
            return undefined;
          }
        });
      },
      debug: {
        lang: lang,
        normalizeTaskStatuses: normalizeTaskStatuses,
        reconcileTaskStatuses: reconcileTaskStatuses,
        acknowledgeTaskStatus: acknowledgeTaskStatus,
        openSessionSafe: openSessionSafe,
        createFreshSession: createFreshSession,
        taskStatusesEqual: taskStatusesEqual,
        isUnstartedSessionRef: isUnstartedSessionRef,
        menuPositionForRect: menuPositionForRect,
        extractSnapshot: extractSnapshot,
        mergeHostData: mergeHostData,
        nestUnder: nestUnder,
        detachEntry: detachEntry,
        canNest: canNest,
        folderOf: folderOf,
        setFolder: setFolder,
        childDir: childDir,
        boundWorkspaceIds: boundWorkspaceIds,
        groupsOf: groupsOf,
        activityTime: activityTime,
        latestTimestamp: latestTimestamp,
        sortBySubtreeActivity: sortBySubtreeActivity,
        sanitizeName: sanitizeName,
        createBranch: createBranch,
        loadStore: loadStore,
        patchStore: patchStore,
        saveStore: saveStore,
        resetStore: resetStore,
        unstow: unstow,
        readForkBoundary: readForkBoundary,
        readInheritBoundary: readInheritBoundary,
        completedTurnBoundary: completedTurnBoundary,
        forkSession: forkSession,
        isSeedUserEntry: isSeedUserEntry,
        seedBlockHeaders: SEED_BLOCK_HEADERS,
        createBranch: createBranch,

        mechanicalDigest: mechanicalDigest,
        compressionPrompt: compressionPrompt,
        seedText: seedText,
        clip: clip,
        messageText: messageText,
        hookKey: hookKey,
        version: VERSION,
        browser: WorkspaceBrowser,
      },
    };
  },
});
