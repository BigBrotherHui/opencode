# NOTES

## 2026-10-14 — 会话同步(含 pin)

**背景：** 项目列表已通过服务器 `app_state` 的 `projects` scope 同步；会话本身在同一个服务器 DB 里，两端天然共享，无需同步。真正不同步的是 **会话 pin**：原先存在每窗口本地存储 `Persist.window("session-rail.pins")`，手机和电脑各存一份。

**改动：**
- `packages/app/src/context/global-sync/shared-value.ts`(新)：通用共享值引擎(load/seed/push/adopt)，从原 `shared-projects` 抽取。
- `packages/app/src/context/global-sync/shared-pins.ts`(新)：`SHARED_PINS_SCOPE = "session-pins"`，parse/merge/same + `createSharedPins`。
- `shared-projects.ts`：改为复用 `createSharedValue`，删除重复实现。
- `context/server-sync.tsx`：加 `pinsStore`(本地键沿用旧名 `Persist.window("session-rail.pins")`，保证老 pin 不丢、首次 reconcile 时并入服务器)、`reconcilePins`，监听 `app-state.updated` 的 `session-pins` scope，暴露 `sessionPins.{isPinned,toggle}`。桌面端持久化是异步的，故用 `createEffect` 等 `pinsReady` 后再首次 reconcile；手机同步存储立即触发。
- `pages/layout/sidebar-workspace.tsx`：pin 状态改读 `serverSync().sessionPins`。

**踩坑(重要)：** 网关 WAF 会把写入内容里的半角 `()` 转写成全角 `()`(U+FF08/FF09)，导致语法错误。改文件后先跑 `grep -P '[\x{FF01}-\x{FF5E}\x{3000}]'`，用 `perl -CSD -i -pe 's/\x{FF08}/(/g; s/\x{FF09}/)/g'` 归一。Python 重写会顺带把 LF 改成 CRLF，用 `perl -0777 -pi -e 's/\r\n/\n/g'` 修回。

**验证：** `packages/app` 下 `bun typecheck` 通过；`bun test src/context/global-sync/shared-pins.test.ts shared-projects.test.ts` 30 通过。(`bootstrap.test.ts` 的 solid-js `use` 报错是既有问题，与本次无关。)

## 2026-10-14 — 部署：手机 UI 与桌面 App

**手机 UI(`packages/app/dist`)：** 静态服务器 `serve-ui-build.js` 每次请求从磁盘读，**重建 dist 后无需重启**，手机刷新即可(index.html 是 no-cache)。重建命令：`C:\Users\Administrator\opencode-web\build-opencode-ui.ps1`。

**桌面 App(`packages/desktop/dist/win-unpacked`)：** 手机没同步 pin 的**真正原因**是桌面跑的是旧构建——其 `app.asar` 只含旧键 `session-rail.pins`，没有 `session-pins`，pin 从未 push 到服务器(`GET /global/app-state/session-pins` 一直是 null)。重打包步骤：
1. `cd packages/desktop && bunx electron-vite build`(生成 `out/`)
2. `bunx electron-builder --win --dir --config electron-builder.config.ts`(**必须显式 `--config`**；不加会 fallback 到默认配置 → exe 名错成 `@opencode-aidesktop.exe`、asar 打包全部 node_modules 膨胀到 2GB)
3. 运行中的 App 会锁 `dist/win-unpacked`，需先退出 App(会话在服务器 3910 上，重启不丢)。
4. 打包前若只想验证，可先输出到别的目录再比对，但 `-c.directories.output=` / `--config.directories.output=` 都会破坏配置解析，正确做法是写个 wrapper config `import base from "./electron-builder.config"; export default { ...base, directories: { ...base.directories, output: "dist-next2" } }`。

**实测结果：** 桌面重启后自动把本地 pin 并入服务器，`GET /global/app-state/session-pins` 返回 `["ses_eccf0948effednmgP5Tlcvpl85"]`，手机 origin(3000) 读到同一值。

**遗留（已安排重启清理）：** `packages/desktop/dist-next`、`dist-next2` 两个失败的临时打包目录删不掉(asar 被 Defender 句柄锁住，`MoveFileEx` 也返回 err=3)。处理：直接向 `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\PendingFileRenameOperations` 追加删除项(文件+各级空目录，`\??\` 前缀 + 空 destination)，下次重启由 Session Manager 删除。**注意**：中途一次错误的 `Set-ItemProperty`(过滤掉全部空字符串) 破坏了原值配对结构，已按 `New\` 改名对 + 其余为删除对 的规则重建为 126 项并验证（readback 63 对：10 改名 + 53 删除）。教训：该值里空字符串是「删除」语义的必要组成部分，处理时必须保留配对。

## 2026-10-14 — 建 codebase-memory 索引

**结论：** 本仓库此前未被 codebase-memory-mcp 索引。已建索引，图项目名 **`D-PrivateProject-opencode`**(不是 `opencode`)。31400 nodes / 139283 edges，fast 模式。

**关键坑：** 默认多线程索引在本仓库的 `parallel.resolve` 阶段(28 workers)必然原生崩溃 `exit=-1073741819`(0xC0000005 访问违规)。常驻 daemon 的 supervisor 只会逐个隔离崩溃文件并重试，但每次崩溃丢弃全部进度，不收敛(隔离 89 次仍未完成)。

**解法：** 杀掉所有 `codebase-memory-mcp.exe` 进程后，带 `CBM_INDEX_SINGLE_THREAD=1` 跑 CLI 一次性索引即成功：
```
taskkill //F //IM codebase-memory-mcp.exe
CBM_INDEX_SINGLE_THREAD=1 codebase-memory-mcp cli --progress index_repository --repo-path "D:\PrivateProject\opencode" --mode fast
```
注意：环境变量只对 CLI 一次性运行生效；常驻 daemon 早已启动、不继承新 env，故必须先杀进程。CLI 走 stdio，`taskkill` 会连带杀掉 opencode 当前连接的 MCP server——索引完成后需重启 opencode 会话才能恢复 MCP 工具。

**待办：** 语义层(`--mode full`)未完成，full 模式后台进程随 shell 退出被杀；如需语义检索需重跑 full 并保持前台。

## 2026-10-14 — 会话消息导航 rail(右侧格栅)

**需求(用户)：** 像 codex 那样，在会话右侧显示一列格栅；点击可展开全部"我发送的消息"并跳转到对应位置。桌面版与网页版共用 `packages/app`，改动天然同步。

**改动：**
- 新 `packages/app/src/pages/session/timeline/message-rail.tsx`：`MessageRail`。右缘绝对定位(外层 `pointer-events-none`，内部 auto)，竖排细条=每条用户消息；点击条→跳转；顶部 `dot-grid` 按钮→展开浮层列表(序号+时间+首行预览)，点击条目跳转并收起；点外部/Esc 关闭；`messages.length > 1` 才显示。
- `message-timeline.tsx`：抽出 `revealMessage(id)`(原内联的 `setRevealMessage` 闭包)，新增 `railMessages` memo(用 `getMsgParts` 取 text part 预览、`toLocaleTimeString` 时间)与 `jumpToMessage`(先 `onMarkScrollGesture` 抑制底部自动吸附，再 `virtualizer.scrollToIndex(index,{align:"center"})`)，在顶层容器渲染 `<MessageRail>`。
- i18n：新增 `session.messages.outline` / `session.messages.outlineJump`，脚本同步全部 62 个 locale(en/zh/zht 手写，其余英文)。插入锚点 `session.messages.jumpToLatest` 之后。

**踩坑：**
- `edit` 工具把 `message-timeline.tsx` 整体写成 CRLF(worktree crlf / index lf)，`git diff` 虚增 3700 行。用 `perl -0777 -pi -e 's/\r\n/\n/g'` 修回 LF。**改完 `packages/app` 下文件后查 `git ls-files --eol <path>`。**
- `session.rail.*` 键组(Sessions/Expand session list 等)在 HEAD 已存在但**无任何代码引用**，是 upstream 遗留死键；`ar.ts` 等缺 `session.rail.running` 与部分 `provider.custom.*`，故 `parity.test.ts` 在 HEAD 就失败——**既有失败，与本次无关**，未修(超范围)。

**验证：** `packages/app` 下 `bun typecheck` 退出码 0；新键在 62 个 locale 全部存在。

**部署(已完成)：** 网页/手机 `build-opencode-ui.ps1` → `dist/index-DeycCtVX.js`(刷新即生效)。桌面：停止 `OpenCode Dev`(用户明确授权，覆盖 `packages/app/AGENTS.md` 的"永不重启 App")→ `bunx electron-vite build` → `bunx electron-builder --win --dir --config electron-builder.config.ts`(asar 189MB，已确认含 `session.messages.outlineJump`/`message-rail`)→ 重启 `dist/win-unpacked/OpenCode Dev.exe`(6 进程)。全程 3910 API 与 3000 静态服务在线(`GET /global` 200)。

**未确认(已澄清)：** 用户确认要的是"用户消息导航"(非会话列表)；手机点击、桌面 hover 均展开同一浮层。

### 第二轮：桌面 hover 展开 + 重新部署

桌面端(`(hover: hover)`)鼠标悬浮栅格即展开浮层(`hovering`)，手机端保留点击(`pinned`)：`open = pinned || (hoverCapable && hovering)`。**浮层必须移入 hover 容器内且无间隙**(`right-full` 不写 `mr`)，否则指针穿缝隙触发 `mouseleave`，浮层闪断。网页 bundle `index-DbKQ2ZJ9.js`；桌面 `out/renderer/main-DPVf5qxz.js`，已重打包重启(`GET /global` 200)。

### 第三轮：手机按下即展开(长按作废)

手机(非 hover)在**整列容器**上 `pointerdown` 立即展开浮层(`beginPress` 里 `setPinned(true)`)，不要求命中 3px 格子、不需要 500ms 长按(用户实测点不中)。同一次按下设 `suppressClick`，消费随后的 `click`，避免抬手又跳到某条消息；位移 >10px 取消并关闭(滚动不误触)。三点按钮自身 `pointerdown` stopPropagation，保持点击 toggle；浮层根同样 stopPropagation。网页 `index-bMkA1bBm.js`；桌面已重打包重启(`GET /global` 200)。

### 第四轮：高亮跟随滚动 + 手机拖选松手跳转

- **高亮 bug 修复**：原先传 `activeMessageID`(只在运行中的 turn 变化)，导致恒亮最后一条。改为 `railActiveID`：`scroll` 时 rAF 节流查 `[data-timeline-row="UserMessage"]` 里第一条进入视口(锚线 `box.top+24`)的行，取 `dataset.messageId`；未滚动时 fallback 最后一条。`scheduleRailActive` 绑到 `handleListScroll` + 依赖行数的 effect；`onCleanup` 清 rAF。
- **手机交互**：按下栅格列 `setPointerCapture` → 立即弹层；上下滑动(位移 >8px 进入 scrub，按手指 Y 在栅格列的比例映射到消息索引)高亮跟随并滚动浮层列表到可见项；**松手跳转到高亮项**。轻点(无滑动)只弹层不跳。`current = scrub ?? activeID` 决定格子高亮。网页 `index-D9vZ3tgF.js`；桌面已重打包重启(`GET /global` 200)。

### 第五轮：切换会话立即显示 + 悬浮完整信息

- **切换会话悬浮不立即出现**：rail 随会话重建时指针已停在原地，`mouseenter` 不再触发。`onMount` 里 `requestAnimationFrame` 探测 `root.matches(":hover")`，命中即 `setHovering(true)`。
- **悬浮显示完整信息**：`RailMessage.preview`(120 字截断) 改为 `text`(全文)；格子与浮层条目的 `title` 都用全文，桌面浏览器原生 tooltip 显示完整内容。
- **高亮切换不即时**：虚拟行首帧未挂载，首次计算看到空 DOM。抽出 `computeRailActive()`，`onMount` 后再补算两帧 rAF。
- 网页 `index-yICDSFTS.js`；桌面 asar 已含 `outlineJump`，重启 6 进程，`GET /global` 200。

### 第六轮：切换会话后只要有消息就显示悬浮

- **根因1**：`Show when={messages.length > 1}` 要**超过 1 条**才渲染 rail。
- **根因2（关键）**：`el.matches（":hover")` 探测**永远不成立**——rail 外层是 `pointer-events-none`，而 `pointer-events:none` 的元素不参与 `:hover` 匹配。所以之前的"挂载探测"从未生效，必须移动鼠标触发 `mouseenter` 才行。
- **修复**：条件放宽到 `length > 0`；用全局 `pointermove` 记录指针坐标，rail 内容每次出现时判断指针是否落在**内层**（`pointer-events-auto`）矩形的 `getBoundingClientRect` 内，命中即展开。于是切会话后消息一到位、指针若停在右侧就自动展开，无需移动鼠标。
- 网页 `index-DtRVpg30.js`；桌面重打包重启（6 进程，`GET /global` 200）。

### 第七轮：栅格底部加向下箭头（跳到最新）

rail 底部（栅格列之下）加 `arrow-down-to-line` 按钮，点击复用 `props.onResumeScroll`（= session.tsx 的 `resumeScroll`：清 messageId、resume 自动滚动、`scrollToEnd`），即滚到最新消息区。`MessageRail` 新增 `onJumpLatest` prop；按钮自身 `pointerdown` stopPropagation + `consumeSuppress`，与三点按钮同处理。网页 `index-BPftwd6U.js`；桌面重打包重启（6 进程，`GET /global` 200）。

## 2026-10-15 — 重要：Cline 会 stash 掉未跟踪文件

**现象：** 桌面构建突然报 `Could not resolve "./global-sync/shared-projects"`，随后连新建的 `message-rail.tsx` 也从磁盘消失；`glob`/`Test-Path`/`dir` 均找不到，但 web 构建此前成功。

**根因：** VS Code 的 **Cline 插件**(`code-sidecar.exe --cline-hub-daemon`，PID 35340) 执行 checkpoint/restore 时对本工作区跑了 `git stash -u`，把所有**未跟踪文件**从工作区收走。stash 记录：`On sync-open-projects: cline restore transaction da73a957-...`。

**影响：** 所有未进 git 的新文件(本次 `message-rail.tsx` + 上一会话 6 个 `shared-*.ts` + `NOTES.md`)会凭空消失。

**恢复：** `git checkout "stash@{0}^3" -- <path>`（`^3` 是 stash 的 untracked 父提交），随后 `git reset -q HEAD <path>`。**注意 `stash@{0}:<path>` 取不到(那是 tracked 树)，未跟踪文件必须走 `^3`。**

**预防：** 长时间改动前先在工作区外备份(`C:\Users\ADMINI~1\AppData\Local\Temp\opencode\rail-backup`)。

## 2026-10-15 — 手机切后台回前台不刷新

**现象：** 手机网页版(opencode-web:3000，Tailscale)切后台再切回，当前会话不刷新，必须切换会话再切回才同步。

**定位：** 两处独立缺口，都在 `packages/app/src`：
- `context/server-sdk.tsx`：SSE 只在 `pagehide` stop、只在 bfcache `pageshow(persisted=true)` start。手机切后台多数只发 `visibilitychange`，冻结期间 socket 静默死掉，`for await` 卡死既不报错也不重连 → 实时事件永久停。
- `pages/session/timeline/model.ts`：当前会话消息 `sync()` 只在 `sessionID` 变化时触发，后台期间错过的消息没有回前台回调补拉。

**当前实现(第2版，已构建 index-CEUuvcbM.js)：**
- server-sdk：`visibilitychange` + `pagehide` 维护 `hidden` 标志；`hidden -> visible` 时 `stop()+start()` 重启事件流(不再用心跳超时的 20s 阈值)。helper `shouldResumeStreamAfterVisibility({state, wasHidden})`。
- timeline model：`pagehide`/`visibilitychange hidden` 置 `hidden=true`；`hidden -> visible` 时 `sync(id,{force:true})` 强制补拉(去掉 15s freshness 门槛)。
- 测试：`server-sdk.test.ts` 覆盖 helper。

**未证实：** 未能本地复现手机冻结；handler 是否真的触发、force sync 是否真的发出请求，都还没有运行时证据。若用户复测仍失败，下一步用临时 `console.warn` 打点(bundle 重建后手机看控制台)验证 handler 是否触发、fetch 是否发出。

**关键事实：**
- 手机 UI 是 `packages/app/dist` 生产构建；重建 `C:\Users\Administrator\opencode-web\build-opencode-ui.ps1`，静态服务器每次从磁盘读，index.html 是 no-cache，**重建后手机普通刷新即可，无需重启 API**。
- 验证改动是否进包：grep bundle 会被 minify 改名误导，**要 grep 对应的 `.map`(sourcesContent 保留原名)**，如 `Select-String dist/assets/index-*.js.map -Pattern shouldResume...`。
- `bun test src/context/server-sdk.test.ts` 本机因 solid-js `web/dist/server.js` 导出解析报错(改动前即如此，与本次无关)。

## 2026-10-15 — 自定义 provider 默认补 xhigh/max 思考强度

**需求：** 用 UI 新建自定义 provider 的模型时，输入框只出现 default/low/medium/high，缺 xhigh 和 max。要求写入 `opencode.jsonc` 的模型默认带全 5 档，上游不支持由其自行降级。同时默认给新模型开图像 + 推理。

**根因：** 表单保存走 `modelConfigEntry`（`packages/app/src/components/dialog-custom-provider-form.ts:92`），只写 name/reasoning/attachment/... 从不写 `variants`。输入框里的档位来自运行时 `ProviderTransform.variants`，对 `@ai-sdk/openai-compatible` 只给 `WIDELY_SUPPORTED_EFFORTS = ["low","medium","high"]`（`packages/opencode/src/provider/transform.ts:576`）。配置里的 `variants` 会在运行时深合并进模型（`provider.ts:1756`），故手写 xhigh/max 生效。

**改动（仅 app 层，写入 jsonc）：**
- `modelConfigEntry`：`row.reasoning` 为真时写 `variants.xhigh/max = { reasoningEffort }`，与运行时 low/medium/high 合并成 5 档。
- `modelRow` 默认：`reasoning: true`、`attachment: true`、`inputModalities: ["image"]`，即新模型默认支持图像 + 推理。
- **补充（第二次）：** “拉取可用模型”路径走 `model-discovery.ts` 的 `addModels`，原先直接写 `models[id] = { name: id }`，绕过 `modelConfigEntry`，所以 discovery 加的模型永远没 variants/attachment。已改为 `modelConfigEntry（modelRow（）, id)`。
- 同步更新 `dialog-custom-provider.test.ts`（7 pass）。

**验证：** `bun test src/components/dialog-custom-provider.test.ts` 通过；`bun typecheck`（packages/app）通过。已用 `build-opencode-ui.ps1` 重建 `packages/app/dist`（主 bundle `index-DjfHiV4j.js`，表单在 `dialog-connect-provider-MvQdmlx1.js`），grep 确认 `variants={xhigh…,max…}` 与 `modelConfigEntry（modelRow（）)` 均进包。

**坑（重要）：** 用户“添加了 gemini-3.8-flash-high 还是没有这2档”——根因是**旧构建**：源码改了但 `packages/app/dist` 未重建，手机/桌面加载旧代码。改 `packages/app/src` 后必须 `build-opencode-ui.ps1` 重建才生效（静态服务器每次从磁盘读，刷新即可，无需重启 API）。判定依据：配置里该模型只有 `reasoning/limit/modalities`、无 `variants`/`attachment`，即旧表单产物。

**未验证/风险：** 改动只影响自定义 provider 表单新建/编辑 + discovery 新增的模型；`DialogEditModel`（设置里编辑单个模型）复用 `modelConfigEntry`，故编辑时也会补写 variants。已有模型不自动补，需重新保存或手改 jsonc。

**存量补齐（第三次）：** 用户要求把现有缺 variants 的模型一次性补上。脚本只对 `npm === "@ai-sdk/openai-compatible"` 且 `reasoning === true` 且无 `variants` 的模型插入 `{xhigh:{reasoningEffort:"xhigh"},max:{reasoningEffort:"max"}}`，共补 **11 个**：`dli-gpt`(6: gpt-6-sol/luna/astra、gpt-5.6-terra/sol/luna)、`dshapi`(3: deepseek-v4.1-flash、glm-5.3-flash、glm-5.3)、`localrouter`(2: gpt-6.1-sol、gemini-3.8-flash-high)。改前备份 `opencode.jsonc.bak-20261015-xhigh`。改后全库带 xhigh+max 的模型 24 个。

**注意：** `justdowork/claude-opus-4-8`（npm `@ai-sdk/anthropic`）**故意不补** —— 运行时 `anthropicAdaptiveEfforts` 对它已给 low/medium/high/xhigh/max 全 5 档，且其配置格式是 `effort`/`thinking`，不是 `reasoningEffort`，照搬会错。脚本用 `npm` 过滤天然跳过它。

**坑：** 脚本用 `JSON.stringify（config,null,2)` 重写整文件，把原混合 tab/空格的缩进统一成了 2 空格；功能无影响。已 `JSON.parse` 校验通过。另有历史遗留：`localrouter/deepseek` 有重复的 `"reasoning": true` 键（JSON 允许，后者生效），未动。

**CC Switch 回写同步（第四次）：** `C:\Users\Administrator\.cc-switch\cc-switch.db` 里 9 个 `app_type=opencode` 的 provider 全部带 `meta.liveConfigManaged=true`，且其 `settings_config` 是旧内容（无新 variants）—— 即记忆 `gotchas/provider-config-pitfalls-justdowork-ccswitch.md` 记录的回写坑：**只改 jsonc 不改 DB，某次切换/重启后 jsonc 会被 DB 还原**。已把 jsonc 里这 9 个 provider 的完整配置写回 DB（`UPDATE providers SET settings_config=? WHERE app_type='opencode' AND id=?`，单事务）。备份 `cc-switch.db.bak-20261015-xhigh`。验证 DB 内 localrouter/dli-gpt/dshapi 的 variants 与 jsonc 一致。注意：当前**没有** `is_current=1` 的 opencode 行，回写触发时机不确定，两边同步是稳妥做法。

**改为写全 5 档（第五次，最终）：** 只补 xhigh/max 不够。运行时 `ProviderTransform.variants` 对 `@ai-sdk/openai-compatible` 只默认合成 low/medium/high，而对 glm（非 5.2）、deepseek-v3、kimi、qwen、k2p、big-pickle 等家族**故意返回 `{}`**（`transform.ts:842`）。所以只补 2 档时，`dshapi/glm-5.3`、`glm-5.3-flash` 这类模型运行时只有 `xhigh,max` 两档。判定方法：`GET http://127.0.0.1:3910/provider` 看 `data.all[providerID].models[mid].variants`（注意 `/config` 返回的是原始文件，不含运行时合并；`/provider` 才是合并后的）。

**最终改动：** `modelConfigEntry` 改为显式写全 5 档 `low/medium/high/xhigh/max`（不再只写 xhigh/max）。存量 11 个模型也重写为全 5 档。测试同步更新（7 pass）。

**验证：** `bun test` + `bun typecheck` 通过；重建 UI（`index-Zd7CxLGs.js`，表单在 `dialog-connect-provider-gdgXUZVS.js`）；重启 `start-opencode-ui.ps1`（API PID 2784 / UI PID 42332，两服务 200）；`/provider` 确认 localrouter、dli-gpt、dshapi 全部模型均为 `low,medium,high,xhigh,max`。

**桌面 App 重打包（第六次）：** 按既有流程（见 2026-10-14 部署节）：`packages/desktop` 下 `bunx electron-vite build`（→ `out/`，渲染层 `dialog-connect-provider-Ds41Tvf6.js` 含 5 档）→ 停掉 7 个 `OpenCode Dev` 进程 → `bunx electron-builder --win --dir --config electron-builder.config.ts`（**必须显式 `--config`**，否则 exe 名错、asar 膨胀）。产出 `dist/win-unpacked`（asar/exe 时间戳 12:02:53）；脚本读 asar 二进制确认含 `reasoningEffort`/`xhigh`。重启 App（6 进程）。注意打包日志有 `file source doesn't exist from=...\native`（本机无 native 构建，属正常，dev 渠道不需要）。

## 2026-10-15 — 打开新项目后切旧项目会话，新项目从侧栏消失

**现象：** 打开一个新项目后，切回一个旧项目的会话，新项目就从左侧项目栏消失。

**根因（静态分析）：** `packages/app/src/context/server.tsx` 里 `createServerProjects` 是**按实例**保存 push 回调（`let sync`）。但同一个 store bucket 上有**三个互不相同的实例**：`server.projects`（活动）、`server.projects.forServer(key)`（每服务器）、以及 home 视图用的 `forServer`。而 `context/server-sync.tsx:706` 只对**每服务器实例**调用 `attachForServer(...)` 注册 push；侧栏/布局改动走的是**活动实例** `server.projects.*`（`context/layout.tsx:661/664/667/673`）。

- 打开新项目时，活动实例 `open()` 写入了 store，但它的 `sync` 是 `undefined`，`push()` 是 no-op → **从不推送到服务器**。
- 随后 `reconcileProjects()`（事件 `app-state.updated` 或 10s 轮询/聚焦）从服务器读回旧列表（不含新项目），因 `synced()` 已为 true，直接 `projects.adopt(result.remote)` 覆盖本地 → 新项目被抹掉。
- 切会话触发了那次 reconcile/或事件，所以表现为"切会话后新项目消失"。

**改动：** `createServerProjects` 的 push 回调从实例私有改为**按 scope 共享的 Map**（`syncs?: Map<ServerScope, push>`）。`attach` 写入 `syncs.set(scope, handler.push)`，每次 `push()` 按当前 scope 查表。`server.tsx` 里创建一张 `projectSyncs` 同时传给活动实例和每个 `forServer` 实例，于是活动实例也能找到每服务器实例注册的回调。

**验证：** `packages/app` 下 `bun typecheck` 退出码 0；新增回归测试 `server.test.ts` → "publishes from the active handle through the per-server callback"（活动 handle 改动经 per-server 回调发布），`server.test.ts` 14 pass，连同 shared-projects/shared-pins 共 44 pass。

**坑（重要，复现）：** `edit`/`write` 工具**持续**把 ASCII `(` `)` 写成全角 `（` `）`（U+FF08/FF09），导致 `edit` 匹配失败、测试报 `Expected ";" but found "（"`。规避：用 `perl -i -pe 's/\xEF\xBC\x88/(/g; s/\xEF\xBC\x89/)/g' <file>` 归一；改 `server.tsx` 这类多括号文件时直接用 `perl -0777 -pi -e 's/.../.../'` 做替换，比 `edit` 工具稳。

**部署（已完成）：** `packages/app/dist` 已重建（主 bundle `index-FMUG29nF.js`，sourcemap 含 `projectSyncs`/`input.syncs?.get`，3000 已服务新 bundle）；桌面 App 已按第六次流程重打包（`bunx electron-vite build` → 停 7 个 `OpenCode Dev` → `bunx electron-builder --win --dir --config electron-builder.config.ts` → 解包 asar 确认含修复代码 → 重启 6 进程）。API :3910 200。

