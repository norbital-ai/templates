# 空白

![空白工作区界面](docs/screenshots/application.webp)

极简 Norbital Bolt 起步模板：仅含一个只读示例模型（`notes`），不含预置应用与自动化，适合从零手写或由工作区智能体快速搭建定制工作区。

## 行业与 Bolt 核心能力

- **适用行业：** 通用（General）
- **Bolt 能力标签：** `data_modeling`

## 系统运作方式

1. **极简声明骨架：** `src/+workspace.ts` 声明时区与语言区域，`src/data/model/notes/+model.ts` 给出最小数据模型示例。
2. **约定式扩展：** 按 Bolt 目录约定陆续添加模型、应用页面、团队策略、自动化与外部集成。
3. **本地或 Studio 构建：** 通过 `bolt check` / `bolt build` 校验构建，或由工作区智能体在 Workspace Studio 直接生成与发布。

## 应用与角色

无。`src/+workspace.ts` 仅声明时区与语言区域，未预置团队或策略；添加首个应用后，工作区外壳会自动提供默认主题与导航。

## 数据模型

| 模型    | 用途                                                 |
| ------- | ---------------------------------------------------- |
| `notes` | 自由格式示例笔记（`title`、可选 `body`）；只读占位符 |

编写首个业务模型后即可替换或删除 `notes`。

## 自动化与集成

无。按 Bolt 标准目录约定扩展此模板：

- **模型：** `src/data/model/<name>/+model.ts`（通过 `@norbital-ai/bolt` 的 `model('<name>', { … })` 声明字段、关联、`outputs`、写入契约与回调）。
- **应用：** `src/app/<app>/+app.ts`，每页对应一个 `+<page>.page.svelte`。
- **自动化：** `src/automation/+<name>.automation.ts`。
- **集成：** `src/integration/<name>/+integration.ts`（`whatsapp`、`email` 等内置渠道无需自定义），在**设置 → 集成**中配对。

工作区智能体（`src/agent/+agent.md`）可通过 Studio 工具直接生成草稿供预览和发布。完整编写契约见
[Norbital OSS 仓库](https://github.com/norbital-ai/oss/tree/main/packages/bolt)。

## 快速开始

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

新工作区完全为空，不含种子数据；`bolt build` 会自动根据 `src/` 刷新 `norbital.template.json` 中的 `counts`。

- [文档目录](docs/README.md)
- [源码参考](docs/source-reference.md)
