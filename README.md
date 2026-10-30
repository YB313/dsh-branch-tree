# dsh-branch-tree

> Treat a session as a folder: fork one conversation into independent branches that share the master's requirements, and browse them as a real tree in the left workspace column.
>
> 把会话当文件夹：母会话变成可展开的文件夹，分支作为缩进子行挂在下面，直接在左侧工作区里浏览。

[English](#english) · [简体中文](#简体中文)

---

## English

### What it does

`dsh-branch-tree` turns the left workspace session list into a tree. A **master session becomes an expandable folder row**, and every **branch hangs underneath it as an indented, collapsible child row** — no extra panel needed to see the relationship.

Branching works by forking the master's log up to a chosen boundary (the end of the master's **first turn**). Every branch therefore:

- sees the same requirement message and md references as the master;
- does **not** inherit the master's later work-in-progress chatter;
- reads the md files **live** — edit the master's requirements and each branch picks up the new version on its next read (files are never copied);
- writes its output into `制图/<master>/<branch>/`.

It also ships a **management panel** for branch creation, moving sessions into folders/workspaces by drag-and-drop, and per-branch task status.

### Requirements

- DeepSeek Harness (`dsh`) with a web-capable profile
- Shared host client packages (declared in `dsh.client.inject`):
  - `@deepseek-ai/dsh-client-ui-sidebar`
  - `@deepseek-ai/dsh-client-ui-conversation`
  - `@deepseek-ai/dsh-client-ui-primitives`
  - `@deepseek-ai/dsh-api-session-controller`
  - `@deepseek-ai/dsh-api-workspace-files`

> Verified against the `dsh` developer preview. The host is evolving — if a client seat is renamed, the plugin **falls back to the shipped session list** instead of breaking your workspace (see the takeover flag below).

### Install

From GitHub (latest `main`):

```bash
dsh plugin --profile web add github:YB313/dsh-branch-tree
```

Uninstall:

```bash
dsh plugin --profile web remove dsh-branch-tree
```

### Usage

1. Click a session row in the left workspace — it becomes the **master folder**.
2. Use the **Branch Tree** panel to create a branch from that master.
3. Double-click / tap the folder row to expand or collapse its branches.
4. Drag a session onto a folder row to nest it, or onto a workspace header to move it there.
5. Branch output lands in `制图/<master>/<branch>/`.

The tree takes over the shipped sidebar session entry point. If the host seat ever throws, the plugin sets `dsh.branch-tree.takeover` to `off` and leaves the native session list alone — you can flip that key back to `on` in localStorage to retry.

### Local state

Everything is stored under `localStorage` keys prefixed `dsh.branch-tree.` (tree shape, collapse state, active session hint, per-branch task status, branch-count visibility). Clearing them resets the view without touching any session data.

### Development

The host half (`index.js`) is intentionally empty — all behaviour lives in the **client** module (`client.js`), loaded through `window.__ModuleLoader__`.

```bash
# smoke test (no dependencies needed)
node test/smoke.mjs

# load the checkout into a test profile via a patch layer
dsh --profile web --patch ./cordis.patch.yml "test task"
```

### License

MIT

---

## 简体中文

### 这个插件做什么

`dsh-branch-tree` 把左侧工作区的会话列表变成一棵树：**母会话变成可展开的文件夹行**，**每个分支作为缩进、可折叠的子行挂在下面**——不用另开面板就能看清从属关系。

分支的实现方式是「从母会话日志 fork 到指定边界」（默认是母会话**第一轮**结束处）。因此每个分支：

- 能看到和母会话相同的需求消息与 md 参考；
- **不会**继承母会话后来那些过程性的啰嗦；
- **实时读取** md 文件——母会话改了需求，分支下次读取就生效（文件本身从不复制）；
- 产物写到 `制图/<母会话>/<分支>/`。

另外附带一个**管理面板**：创建分支、拖拽把会话归入文件夹/工作区、查看每个分支的任务状态。

### 环境要求

- DeepSeek Harness（`dsh`），profile 需支持 web
- 宿主共享客户端包（已声明在 `dsh.client.inject`）：
  - `@deepseek-ai/dsh-client-ui-sidebar`
  - `@deepseek-ai/dsh-client-ui-conversation`
  - `@deepseek-ai/dsh-client-ui-primitives`
  - `@deepseek-ai/dsh-api-session-controller`
  - `@deepseek-ai/dsh-api-workspace-files`

> 已在 `dsh` 开发者预览版下验证。宿主仍在变动——若某个客户端挂载点被改名，插件会**自动退回原生会话列表**，不会搞坏你的工作区（见下方 takeover 开关）。

### 安装

从 GitHub 安装（跟随 `main`）：

```bash
dsh plugin --profile web add github:YB313/dsh-branch-tree
```

卸载：

```bash
dsh plugin --profile web remove dsh-branch-tree
```

### 使用

1. 点击左侧工作区里的某个会话行——它就成为**母文件夹**。
2. 在 **Branch Tree** 面板里从该母会话创建分支。
3. 点文件夹行展开/折叠它的分支。
4. 把会话拖到文件夹行上即归入其下，拖到工作区标题即整体移过去。
5. 分支产物落在 `制图/<母会话>/<分支>/`。

树接管了原生的侧边栏会话入口。若宿主挂载点抛出异常，插件会把 `dsh.branch-tree.takeover` 置为 `off`，让原生列表继续工作——你可以在 localStorage 里把它改回 `on` 重试。

### 本地状态

全部存放在以 `dsh.branch-tree.` 为前缀的 `localStorage` 键里（树结构、折叠状态、当前会话提示、分支任务状态、分支计数显隐）。清掉它们只会重置视图，不会动任何会话数据。

### 开发

宿主半部（`index.js`）刻意留空——所有行为都在 **客户端**模块（`client.js`）里，通过 `window.__ModuleLoader__` 加载。

```bash
# 冒烟测试（零依赖）
node test/smoke.mjs

# 用 patch 层把当前 checkout 挂进测试 profile
dsh --profile web --patch ./cordis.patch.yml "测试任务"
```

### 许可证

MIT
