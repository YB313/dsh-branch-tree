# 发布到 GitHub 的清单（维护者用）

目标：把仓库推成 `https://github.com/YB313/dsh-branch-tree`，并挂一个可被 `dsh plugin add` 直接安装的 Release 资产。

## 1. 进仓库的内容（这些文件已经在 `dsh-branch-tree/` 里备好）

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包元数据；`version 1.3.1`；`dsh.client.inject` 声明宿主包依赖；`files` 决定打包内容 |
| `client.js` | 全部行为（约 4.4k 行），通过 `window.__ModuleLoader__` 加载 |
| `index.js` | 宿主半部，只有一个空 `apply()` |
| `cordis.patch.yml` | 宿主 patch 层，`dsh.bundle.patch` 指向它 |
| `locale/zh.json`、`locale/en.json` | locale meta（正文文案在 `client.js` 的 `DICT`/`EXTRA` 里） |
| `icon.svg` | 面板图标 |
| `README.md` | 中英双语说明（三种继承模式、不合并对话、安装、开发） |
| `CHANGELOG.md` | 版本变更记录 |
| `LICENSE` | MIT |
| `test/smoke.mjs` | 零依赖冒烟测试（218 checks） |
| `scripts/check-release.mjs` | 版本一致性 + 无 AppleDouble 检查 |
| `.github/workflows/smoke.yml` | push/PR 跑语法检查 + 冒烟 + 包内容检查 |
| `.gitignore` | 忽略 `*.tgz`、`.DS_Store`、`前置版本们/` |

**不要提交**：`*.tgz`（Release 资产单独上传）、`.DS_Store`、`前置版本们/`、`Old versions/`。

## 2. 本机 git 的可用姿势（2026-11-03 实测）

系统自带的 `/usr/bin/git` 是坏的：

```
xcrun: error: unable to load libxcrun (dlopen(.../libxcrun.dylib ...)):
mach-o file, but is an incompatible architecture (have 'x86_64', need 'arm64e')
```

`tar`、`python3` 同样被这个 xcrun 问题拖坏。但 **GitHub Desktop 自带的 git 是好的**（2.56.0，arm64），

```bash
GD="/Applications/GitHub Desktop.app/Contents/Resources/app/git/bin/git"
export PATH="/Applications/GitHub Desktop.app/Contents/Resources/app/git/bin:$PATH"
"$GD" --version          # git version 2.56.0
```

认证走 `~/.ssh/id_ed25519`（已授权给账号 YB313，`ssh -T git@github.com` 能过），**不需要 Personal Access Token**。

### 关键坑：push 会报 `remote unpack failed: index-pack failed`

第一次推完整历史时主机侧会回：

```
remote: fatal: early EOF
error: remote unpack failed: index-pack failed
```

原因是默认的 thin pack 在这台机器/这条链路上会被截断。**加 `--no-thin` 即成功**：

```bash
"$GD" push --no-thin -u origin main
"$GD" push --no-thin origin v1.3.1
```

（每次调用都会打印一行 `xcrun: error: unable to load libxcrun ...`，那是 git 调 `xcrun` 的噪音，不影响结果。）

### 其它两条备用路

- **网页上传**：把 `dsh-branch-tree_github_261103ver.zip` 解压后，在仓库页 `Add file → Upload files` 整目录拖上去。
- **另一台能跑 git 的机器**：`git clone` 后把本目录内容覆盖进去再推。

## 3. 发布步骤

1. 本目录自检：

```bash
node --check client.js
node test/smoke.mjs                 # 期望 SMOKE OK (218 checks)
node scripts/check-release.mjs      # 期望 release check OK: dsh-branch-tree@1.3.1
```

2. 打 tag 并推：

```bash
git tag -a v1.3.1 -m "dsh-branch-tree v1.3.1"
git push origin main --tags
```

3. GitHub → Releases → Draft a new release：tag 选 `v1.3.1`，标题 `v1.3.1`，正文直接粘 `CHANGELOG.md` 的 1.3.1 段，附件上传 `dsh-branch-tree_v52_261103ver.tgz`。

4. 装一份验证（干净 profile 或者换台机器）：

```bash
dsh plugin --profile web add https://github.com/YB313/dsh-branch-tree/archive/refs/tags/v1.3.1.tar.gz
```

打开 web GUI：左侧会话行右键应出现 **＋ 派生分支…**，draft 里有 **全景继承 / 压缩继承 / 开头继承** 三个按钮，底部版本号显示 `v52`。

## 4. 版本号约定

- `package.json` 的 `version` 是发布版本（semver）。
- `client.js` 里的 `const VERSION = 'v52'` 是 UI 品牌短号（显示在面板底部），两者不需要相等，但都要在发布时递增。
- `README.md` 顶部与 `CHANGELOG.md` 必须提到当前版本，`scripts/check-release.mjs` 会拦。

## 5. 打包注意（历史坑）

macOS 系统 `tar` 会把 `._*` AppleDouble 条目和 `PaxHeader/` 目录塞进包，装进 profile 后宿主直接报
`dsh-branch-tree/locale/._en.json must use a language id as its filename`，插件起不来。
所以发布包必须用**自写 ustar**（`/tmp/mktar_v52.mjs`，node + zlib）或 `COPYFILE_DISABLE=1 tar`，并验证：

- 包内无 `._` 条目；
- 包内 `client.js` 的 md5 与源码一致；
- 11 个条目（`dsh-branch-tree/` + 目录 + 9 个文件…… 以实际 `files` 列表为准）。
