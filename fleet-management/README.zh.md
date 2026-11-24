# 车队管理 (`norbital_fleet_management`)

![车队管理实时地图与在途调度](docs/screenshots/application.webp)

实时 **GPS 应答器定位追踪、在线车辆地图、路线调度与预计到达时间（ETA）、电子围栏及超速/离线告警** 系统，运营调度与系统配置完全隔离。

## 核心能力

1. **实时车队地图与 GPS 应答器遥测流水（`vehicles` / `telemetry_pings`）**
   - 通过 `gps_transponder` 集成同步定位数据（`telemetry_pings.syncs.transponder`，每 5 分钟轮询并在收到 HMAC-SHA256 签名 Webhook 提示时即时唤醒），或批量上传 CSV/XLSX 轨迹文件（`telemetry_pings.syncs.gps_csv`）。
   - 每条 GPS 采样写入不可变追加式 `telemetry_pings` 台账，并在提交后通过持久化副作用原子刷新所属车辆的最新坐标、车速、航向、点火、里程、油量、在线状态以及 CEL 计算字段 `is_overspeed`。
   - 原生 `<Map>` 实时呈现全车队定位、速度徽章与指向当前在途目的地的路线连线。
2. **路线调度、途经点与动态 ETA（`routes`）**
   - 管理完整路线生命周期（`planned -> dispatched -> en_route -> arrived -> completed | cancelled`），支持有序途经点 `route_waypoints`、自动里程与实时 `eta_minutes`。
   - 路线派发、改派车辆或在途时自动同步车辆目的地，完成或取消后自动释放车辆状态。
   - 支持一键刷新实时 ETA（`refresh_route_eta`），可结合可选 **Google Routes** 路况接口并在预计晚点时自动触发 `route_delay` 告警。
3. **电子围栏与异常告警（`geofences` / `fleet_alerts`）**
   - 配置车场、工地、客户点、主干道及禁行区电子围栏、半径、区域限速与进出触发条件。
   - 超速、进出围栏、应答器离线（`check_fleet_health` 检测超 30 分钟无心跳）与路线延误自动写入 `seq` 编号告警台账并推送调度通知。

## 导航与独立配置应用

- **车队运营**：`实时地图`（地图与在途调度双栏）、`车辆台账`、`路线调度`、`异常告警`。
- **系统配置**（独立隔离）：`外部连接`（GPS 应答器网关与 Google Routes）、`电子围栏`（表格与地图双栏）、`驾驶员`。

更多细节见 [docs/README.md](docs/README.md) 与 [docs/source-reference.md](docs/source-reference.md)。
