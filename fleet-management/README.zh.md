# 车队管理

![车队管理应用界面](docs/screenshots/application.webp)

实时 **GPS 应答器定位追踪、在线车队地图、路线调度、电子围栏与遥测告警**工作区，将日常车队调度与遥测系统配置清晰隔离。

## 核心能力

- **实时车队地图与 GPS 遥测流：** 通过 `gps_transponder` 集成（每 5 分钟轮询，支持 HMAC-SHA256 签名 Webhook 即时唤醒）或 CSV/XLSX 批量轨迹上传采集定位数据（经纬度、速度、航向、点火、里程、油量等）；每条采样写入只追加的 `telemetry_pings` 并原子刷新车辆实时快照与 CEL 计算字段 `is_overspeed`。
- **路线调度、途经点与实时 ETA：** 管理完整行程周期（`planned → dispatched → en_route → arrived → completed | cancelled`），支持有序途经点 `route_waypoints`、自动同步车辆目的地，并可通过可选 **Google Routes** 刷新实时路况预计到达时间。
- **电子围栏与异常告警：** 配置车场、工地、客户点、主干道与禁行区圆形围栏、区域限速及进出触发条件；超速、越界、应答器离线（> 30 分钟）及路线延误自动生成 `seq` 编号告警（`open → acknowledged → resolved`）。

## 应用与角色

| 应用         | 页面                       | 受众 / 角色                                      |
| ------------ | -------------------------- | ------------------------------------------------ |
| **车队运营** | 实时地图、车辆、路线、告警 | `调度员`、`车队经理`、`驾驶员`（本人路线与只读） |
| **系统配置** | 外部连接、电子围栏、驾驶员 | `车队经理`（独立隔离的遥测与基础配置）           |

## 数据模型

共 6 个模型与 1 个自定义字段（`route_waypoints`）：

- `vehicles` — 配备应答器的车队资产（含 `is_overspeed` CEL 计算字段与 5 标签车辆中心）。
  - `telemetry_pings`（`owned: true`）— 只追加 GPS 采样流水（`transponder` HTTP/Webhook 同步与 `gps_csv` 文件同步）。
- `routes` — `seq` 编号调度路线，含 `route_waypoints` 与结案锁定（`closed_locked`）。
- `fleet_alerts` — `seq` 编号异常告警台账（结案锁定 `resolved_locked`）。
- `geofences` — 圆形电子围栏、区域限速与进出触发规则。
- `drivers` — 商业驾驶员与驾照合规记录。

## 自动化与集成

| 自动化 / 集成        | 触发方式 / 类型           | 用途                                                        |
| -------------------- | ------------------------- | ----------------------------------------------------------- |
| `refresh_route_eta`  | 手动（实时地图 / 路线）   | 基于 GPS 速度或 Google Routes 重算 ETA 并标记 `route_delay` |
| `check_fleet_health` | 每 15 分钟 / 手动         | 扫描超 30 分钟无心跳的应答器并触发 `transponder_offline`    |
| `gps_transponder`    | Webhook 唤醒 / 5 分钟同步 | 从应答器网关拉取实时定位（支持 HMAC-SHA256 验签）           |
| `google_routes`      | 可选 HTTP 集成            | 为在途路线提供实时路况 ETA                                  |

## 快速开始

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

新工作区初始为空：可在**系统配置**录入驾驶员、电子围栏并绑定 `gps_transponder` / `google_routes`，或在车辆页面导入 CSV/XLSX 轨迹。

- [工作流指南](docs/README.md)
- [源码参考](docs/source-reference.md)
