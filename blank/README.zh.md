# 空白

一个空的 Norbital 工作区：一个只读的起始模型（`notes`），没有应用，也没有自动化。
它是借助工作区智能体从零开始构建工作区的起点。

## 应用与角色

无。`src/+workspace.ts` 只声明时区和语言区域，未编写任何团队或策略。
起始模板包含 Runed、std 和 Iconify，用于编写普通模块和自定义界面；
主题行为由工作区外壳负责。源码用到其他依赖时再添加。

## 数据模型

| 模型    | 用途                                                       |
| ------- | ---------------------------------------------------------- |
| `notes` | 自由格式的笔记（`title`，可选 `body`）；只读，没有写入契约 |

第一个真正的模型建立后，替换或删除 `notes`。

## 自动化与集成

无。在起始模板的基础上构建：

- 模型位于 `src/data/model/<name>/+model.ts`：存储、`ref` 字段、对外开放（`outputs`、
  `create`、`update`、`delete`）以及逻辑都写在一次 `model('<name>', { … })` 调用中，从
  `@norbital-ai/bolt` 导入（没有 `outputs` 的模型不可见）。
- 应用位于 `src/app/<app>/+app.ts`，每个页面对应一个 `+<page>.page.svelte`。
- 自动化位于 `src/automation/+<name>.automation.ts`。
- 外部账号即集成：定义位于 `src/integration/<name>/+integration.ts`
  （Bolt 的会话集成，例如 `whatsapp` 和 `email`，已内置），命名实例写在
  `src/+workspace.ts` 的 `connections` 中，还可以选择绑定到该实例的使者（设置中的一条 `sys_envoy` 行）。
  管理员在**设置 → 集成**中配对每个实例，凭据在此输入并始终保持密封。

工作区智能体（`src/agent/+agent.md`）可以通过其 Studio 工具
（`workspace_grep`、`workspace_write` 和 `workspace_diagnose` 工具）编写上述全部内容，这些工具写入私有草稿，
由人员预览并发布。编写契约位于
[Norbital OSS 仓库](https://github.com/norbital-ai/oss/tree/main/packages/bolt)；
`authoring-tenant-workspace` 技能是其发布的摘要。

## 种子数据

无。

## 检查

```bash
bun install
bunx bolt check   # types, Svelte warnings, layout and declarations
bun run test    # bolt test
```

`tests/blank.test.ts` 根据 `src/` 重新计算模型、应用和自动化的数量，与
`norbital.template.json` 中的 `counts` 不一致时即失败：请在同一次变更中同时更新两者。

## 维护中的源码参考

当前的应用/页面、模型输出与写入、自动化策略、集成以及浏览器截图，请参阅[源码参考](docs/source-reference.md)。该清单会与本模板的声明进行核对；提供方配置和已部署发布版本的就绪情况仍属单独的检查。
