# refs — 从 DSH 桌面应用 bundle 中提取的原始参考

这些文件是从 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`
中按字节提取的**原样**内容，仅用于让 dsh-DSchat 的界面与 DSH 原生界面保持一致的
设计语言。运行时不依赖它们。

| 文件 | 来源 | 用途 |
|---|---|---|
| `dsh-tokens.css` | `packages/client/ui-theme/src/styles/*` | DSH 调色板与 alias token 定义（浅色 + `body[data-ds-dark-theme]` 深色），插件样式直接消费这些 `--dsw-*` 变量 |
| `sidebar.css` | `packages/client/ui-sidebar/SidebarRoot.module.css` | DSH 侧边栏样式（类名前缀 `_3WPZCG_`），原型用它还原真实侧边栏外观 |
| `dsh-plugin-authoring-guide.raw.txt` | `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/` | DSH 官方插件开发指南（Persistent Harness plugins / Harness plugin practices / UI plugins / User actions）。本插件的槽位接入方式、样式只用 token、`install_bundle` 安装、以及「替换包需重启」这些结论都出自这里 |

## 关键结论（来自官方指南，已在本插件中验证）

- 客户端产物必须是 `window.__ModuleLoader__.load({ id: <包名>, factory(require) {...} })`，
  `id` 等于包名；React 从宿主模块表取，不要安装重复的 React。
- 通过槽位扩展：`ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`；
  **不要**在组件之外写 DOM，也**不要** `require` 其它 Harness Client 包（`dsh.client.inject` 只用于排序激活）。
- 样式只用 `--dsw-alias-*` 这类主题 token；颜色值仅限插图。
- 安装走 `plugin_manager action=install_bundle`，不要手改 profile 的 package.json / cordis.patch.yml，
  也不要在 profile 目录里跑 pnpm。
- **替换已安装包的 JS 产物需要重启 Harness**：仅切换插件开关不会重新导入模块世代
  （已用三个独立探针验证：探针模块体在 toggle 时从未执行）。

## 重新提取

```bash
A="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
off=$(grep -aob -e '--dsw-alias-bg-base:' "$A" | head -1 | cut -d: -f1)
dd if="$A" bs=1 skip=$((off-1000000)) count=2000000 2>/dev/null | tr -d '\000' > extract.css
```

读取 asar 内的具名文件（不要给 grep 传以 `--` 开头的模式，会被当成选项）：

```bash
node /tmp/asar2.js cat 'cordis-plugin-development/references/(ui-plugin|host-plugin)\.md$'
```
