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


## 2026-10-15 — 侧栏项目右键菜单加「在文件资源管理器中显示」

**需求：** 左侧项目栏的项目右键菜单里加一项，在文件管理器（Explorer）中打开项目文件夹。

**实现：** `packages/app/src/pages/layout/sidebar-project.tsx` 的 `ProjectTile`（项目图标右键 ContextMenu）加 `ContextMenu.Item`，动作调 `platform.openPath(project.worktree)`。门控与主页「Reveal in File Explorer」一致：`canReveal = platform==="desktop" && !!platform.openPath && server.isLocal()`；标签复用 `fileManagerApp(os).actionLabel`（Windows=「在文件资源管理器中显示」），失败 toast 复用主页同款 `common.requestFailed` + `errorMessage`。菜单顺序：Edit / **Reveal** / Workspaces / Clear / Close。手机（web）平台不显示该项（`openPath` 仅桌面存在），与主页行为一致。

**验证：** `packages/app` typecheck EXIT=0；helpers/server/shared-projects 60 pass。整仓单测 778 pass / 1 fail——fail 是 `i18n parity` 的 ar.ts 缺 6 个 key（`provider.custom.*`、`session.rail.running`），已在 `origin/dev` 上核实同样缺失（scripts 对比 en/ar 两文件，dev 与 HEAD 缺失集合相同），属存量问题非本次引入。

**部署：** 桌面 `bunx electron-vite build`（主 bundle `main-BjSogjra.js`）→ 停 7 个 `OpenCode Dev` → `bunx electron-builder --win --dir --config electron-builder.config.ts` → asar 二进制搜到 `project-reveal-menu` → 重启 6 进程。手机 UI 按常规重建（`index-DznuRfkz.js`，含代码但平台门控不显示）。API :3910 与 :3000 均 200。

**说明：** 此改动未提交（工作区仅 `sidebar-project.tsx` 一个文件 M，另有两个 gitignore 的 dist-next 目录 untracked）。


## 2026-10-15 — 恢复 app 的 followup 消息排队（两套设置 UI，手机+桌面）

**背景：** 用户反馈"发消息没有排队"。静态分析+git 确认：app 曾有排队（feat #17233），被 `ae7e2eb3fb chore(app): remove queued follow-ups for now`（2026-04-03）移除——`settings.general.followup` 被强制迁移为 `steer`，`queueEnabled` 恒 false，队列坞/排水链路成死代码。服务端 V2 core 的 steer/queue inbox 一直存在（`core/src/session/input.ts` 的 promoteSteers/promoteNextQueued），但 app 的 prompt 走 legacy `SessionPrompt`（`ensureRunning` 只 join，不打断在途回答）。相关可视化在未合入的分支（#53076/#53338 等）。

**改动（packages/app 3 文件）：**
- `context/settings.tsx`：删强制迁移 effect；getter/setter 还原直读直写；默认值 `followup` 改 `"queue"`（上游原默认是 steer）。
- `components/settings-general.tsx`：恢复 followup 选项行（Select，`data-action="settings-followup"`）。
- `components/settings-v2/general.tsx`：GeneralSection 里加 SelectV2 同款行。

**行为：** 忙碌时提交 → 入本地队列（persist，不即发），坞显示"N 条排队消息"（立即发送/编辑）；会话 idle 时排水 effect（session.tsx:1928）自动发队首；点停止（paused）挂起；失败项留坞可重发。空闲时提交照常直发。翻译键 en.ts:997-1000 / zh.ts:980-983 一直存在，未改 i18n。

**验证：** app 与 desktop `bun typecheck` 通过；产物 chunk（dialog-settings-*.js、index-*.js）里搜到 `settings-followup`；桌面 renderer 主包 main-BMlzRCKh.js。

**部署：** 手机 `build-opencode-ui.ps1`（主包 `index-DU2LC-bz.js`；serve 脚本对 html 设 no-cache，手机刷新即生效，无需重启）。桌面 `bunx electron-vite build` → `bunx electron-builder --win --dir --config electron-builder.config.ts`（exe 重写于 22:29:43；当时桌面 App 未在运行，无需停进程）。**未提交**：工作区 M = settings.tsx / settings-general.tsx / settings-v2/general.tsx。


## 2026-10-15 — 排队在手机无效：根因是持久化设置覆盖新默认值（已修）

**现象：** 手机端连发 2 条消息，第二条不排队、直接发出。

**根因（静态确认）：** `settings.v3` 是**设备本地**持久化（`persisted("settings.v3", createStore<Settings>(defaultSettings))`，`utils/persist.ts`）。store 从创建时就从当时的 `defaultSettings` 拿到 `followup:"steer"`；此后任何一次设置写入（如 newLayoutDesigns 等自动 effect）都会把**整个 blob**（含 followup:"steer"）落盘。加载时 `normalize → merge(defaults, stored)`：标量以**存储值**为准（persist.ts:198 `return value`），所以光把默认值改成 "queue" 对已有设备无效——存储里焊着 "steer"。另：手机若未刷新，连新 bundle 都没加载（需要刷新页面才能拿到新设置行/队列坞）。

**修复（settings.tsx）：** 加一次性迁移 effect——`followupChosen !== true 且存储值为 "steer"` 时翻回 "queue"；`setFollowup` 同时写 `followupChosen: true`，此后 UI 上的显式选择（含选回 steer）永不被迁移覆盖。`Settings` 接口加 `followupChosen?: boolean`。

**验证：** app/desktop typecheck 通过；手机主包重建为 `index-D58UIwn9.js`；桌面 renderer main `main-D4AlZSBa.js` 并重打包 win-unpacked。手机需**刷新页面**后生效；桌面需**重新启动** App。

**备选（未采用）：** bump 存储 key（会重置全部设置）、让用户手动在设置里选「排队」（每个设备都要手动一次）。


## 2026-10-15 — PWA 化（档1/2）+ Web Push 完成提醒（档3）

**档1/2（SW + 安装）：** `packages/app/public/sw.js`（新）——导航 network-first→缓存兜底（离线壳）、哈希资源 cache-first、`/api|/event|/session` 等前缀一律不拦截（与 serve 脚本 API_PREFIX 同步）；dev 不注册、`entry.tsx` 只在 `PROD + isSecureContext` 注册；`serve-ui-build.js` 对 `/sw.js` 加 `no-cache`（否则 max-age=86400 卡更新）。manifest/icons/apple-meta 仓库本来就有。**手机要 https 才会注册 SW**（Secure Context 硬门槛）。

**档 B（HTTPS）：** Tailscale Serve 未启用。需管理员点一次：`https://login.tailscale.com/f/serve?node=nYHkPhzUhG11CNTRL`，之后跑 `tailscale serve --bg 3000`（已挂起过一次，启用后重跑即可）。生效后手机改访问 `https://desktop-noecbeh.tailcd9d62.ts.net/`。**注意：origin 改变 → 手机 localStorage 重置一次（settings/队列/布局），服务端会话不受影响。**

**档 C（Web Push，全部在 opencode-web，不侵入 opencode 本体）：**
- `push-daemon.js`（新）：VAPID 存 `push-keys.json`（web-push 生成）；订阅存 `push-subscriptions.json`；SSE 连 `127.0.0.1:3910/event`，监听 `session.idle` → 8s debounce（合并子会话抖动）→ `GET /session/{id}` 取 parentID 跳过子会话 → `web-push` 发送（404/410 自动剪除）。
- `serve-ui-build.js`：挂 `/pwa/push/key|subscribe|unsubscribe`（同进程，无新端口）；`npm i web-push`（web-push 依赖目录 package.json 已在 opencode-web 生成）。
- app 侧：`src/utils/push.ts`（新）——权限请求 + `pushManager` 订阅/退订 + 服务端同步（同 key 幂等，异 key 自动轮换）；`context/notification.tsx` 挂了同步 effect（桌面跳过）；两套设置 UI 的「agent 通知」开关在开启时请求权限。
- 已验：typecheck 通过；`/pwa/push/key` 返回公钥；subscribe/unsubscribe 204+文件落盘；UI 日志 `push: SSE connected (200)`。手机端最终 E2E（通知到达）待 HTTPS 生效后在手机上验证。
- 构建：手机 `index-BUuvNfWA.js`；桌面 renderer `main-DX89x21v.js`（exe 已重打包）。

**未提交：** ~~opencode-web 侧新文件 push-daemon.js、package.json、push-keys.json（scripts 非仓库）~~ → **现已修正**：opencode-web 是独立 git 仓库，已推送至 `github.com/BigBrotherHui/opencode-web`（私有）；push-daemon.js/serve-ui-build.js 已入库，密钥/订阅/日志/PID 被 .gitignore 排除。opencode 侧分支 `sync-open-projects` 亦已推送到 fork。

**前置条件：** iOS 需 16.4+ 且**已添加到主屏**才允许 Web Push；Android Chrome 需 GMS 推送。推送与「agent 通知」开关绑定（关掉即退订 + 服务端删除）。

### 2026-10-15 深夜 — 推送 E2E 打通的两个关键点

1. **VAPID subject 不能用 `.local`**：`mailto:push@opencode.local` 被 Apple 推送服务以 403 `BadJwtToken` 拒绝；改成 `mailto:push@example.com` 后 201 全过（push-daemon.js 已修，UI 进程已重启）。排查法：用独立 node 脚本逐个 subject 试发。
2. **iOS 通知授权只能由点击触发**：`settings.notifications.agent` 默认就是 `true`，导致开关"默认开着但从未被点击过"→ 授权弹窗从未出现 → 无订阅。解法：把开关**关掉再打开**（一次点击）即完成授权 + 订阅；服务器日志出现 `push: subscription registered`（端点为 web.push.apple.com）。测试推送已被 Apple 受理（201）且**用户已在 iPhone 上确认收到**。PWA + Web Push 全链路打通。
3. 重启 UI 进程的稳妥方式：改完 serve-ui-build.js/push-daemon.js 后 `Stop-Process ui.pid` + `Start-Process node serve-ui-build.js`（只重启 UI，不动 3910 API）；注意从 opencode 的 bash 工具里带 `-RedirectStandardOutput` 启动会被工具句柄检查掐掉，命令本身已生效、直接查端口/日志即可。

### 2026-10-16 凌晨 — "收不到推送"的两个真因（已修）

1. **守护连错流**：实例级 `/event` 按目录过滤（handlers/event.ts:37 `event.location?.directory === instance.directory`），裸连（无 directory 上下文）只能收到 server cwd 那个默认实例的事件 → 用户会话的事件全部被滤掉。**全局流是 `/global/event`**（groups/global.ts），但它的事件包了一层 GlobalBus 信封 `{"directory":...,"payload":{"id","type","properties"}}`（且有 type:"sync" 的重复条目要跳过），解析时取 `entry.payload`。守护已改为连 `/global/event` + 解析信封。
2. **8 秒防抖已移除**（用户要求"一结束就发"）：改为 idle 事件 → 立刻查会话 → 子会话（parentID）过滤 → 立即 send；用 per-session 5s 去重代替防抖，防止同一会话的重复 idle 事件发多条。
3. **人工触发 idle 的测试技巧**：`POST /session/{id}/abort` 对空闲会话也可用——cancel 无 runner 时仍会 `status.set(idle)` → publish `Event.Idle`，可零成本验证推送链路（日志出现 `push: turn complete`）。
4. `/global/event` 实测事件样例：`data: {"directory":"D:\\PrivateProject\\opencode","project":"...","payload":{"id":"evt_...","type":"session.idle","properties":{"sessionID":"ses_..."}}}`。

### 2026-10-16 — 推送点击只回首页：payload url 深链修复

**现象：** 通知能收到，但点击只回到 opencode 首页，不跳会话。
**根因：** push-daemon.js 发送负载里 `url` 硬编码为 `'/'`。
**修复：** url 改为会话深链 `/{base64UrlEncode(session.directory)}/session/{session.id}` —— base64 是 URL-safe 变体（`+→-`、`/→_`、去 `=`），与 `core/util/encode` 的 `base64Encode` 一致；SW 的 notificationclick（navigate/openWindow）无需改动。
**验证：** 日志 `push: turn complete ... -> /RDpcUHJpdmF0ZVByb2plY3Rcb3BlbmNvZGU/session/ses_...`。
