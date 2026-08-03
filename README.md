# Tesla Cam Viewer 🚗

一个纯浏览器的 Tesla 行车记录仪视频查看器。无需后端，无需安装，打开网页就能浏览哨兵模式录像、手动保存视频和循环录像，支持 6 路摄像头同步播放。

🔗 <a href="https://turboturn.github.io/tesla-cam-viewer/" target="_blank">在线体验</a>

[English Version](README_EN.md)

## 功能特性

- **拖拽选择 TeslaCam 文件夹** — 选择 U 盘根目录，所有事件自动出现在侧边栏
- **6 路摄像头同步播放** — 前摄、后摄、左柱、右柱、左后视、右后视，2×3 宫格布局
- **多种布局切换** — 支持宫格（2×3）、双摄、四摄、单摄视角
- **多段连续播放** — 几十段 1 分钟的视频无缝拼接，统一进度条 + 段分界标记
- **跨段拖动进度** — 拖动进度条可以跳转到任意时间点，自动加载对应片段
- **带时间戳截图** — 一键截取所有摄像头的合成截图，叠加实时时间戳
- **视频导出** — 通过 Canvas + MediaRecorder 导出多路合成视频（MP4）
- **SEI 遥测解码** — `sei-telemetry.js` 纯前端解码 Tesla H.264 SEI 内嵌的 protobuf 遥测数据（速度、GPS、转向、自动驾驶状态等）
- **键盘快捷键** — Space（播放/暂停）、← →（±5 秒快进快退）
- **手机端适配** — 侧边栏改为抽屉式，按钮竖排布局
- **暗色主题** — Tesla 风格深色 UI

## 截图

![Tesla Cam Viewer - 6 cameras + timeline](https://stephenyi.cn/tesla-cam/compare-250k.jpg)

## 快速开始

1. 克隆或下载本项目
2. 用浏览器打开 `index.html`
3. 点击 **选择文件夹**，选中 TeslaCam U 盘根目录
4. 左侧会出现事件列表，点击即可播放

也可以用任意 HTTP 服务器托管，方便手机访问：

```bash
python3 -m http.server 8080
```

然后手机浏览器打开 `http://你的IP:8080`

## 原理

一切都在浏览器里完成。零依赖、零构建、零后端。

### 文件解析
自动识别 TeslaCam 目录结构：
- `SentryClips/` — 哨兵模式事件，按子文件夹分组
- `SavedClips/` — 手动保存的事件
- `RecentClips/` — 循环录像，按日期合并（同一天的所有片段归为一个事件）

每个事件的每段视频都包含 6 个摄像头的 `.mp4` 文件。

### 同步播放
以前摄为时钟源（master），其余视频通过 `timeupdate` 事件追齐。偏差超过 0.3 秒自动校正。

### 多段连续播放
串行预加载各段时长，计算出总时长和段偏移量。进度条展示全段时间跨度，白色竖线标记段边界。当前段播完后自动加载下一段并继续播放。

### SEI 遥测（可选）
Tesla 在 H.264 视频流的 SEI NAL 单元中以 protobuf 格式嵌入了车辆行驶数据。`sei-telemetry.js` 实现了完整的浏览器端解码：

- 速度（m/s → km/h）
- GPS 坐标
- 油门踏板深度、刹车状态
- 方向盘转角、转向灯
- 自动驾驶状态（关闭/FSD/Autosteer/TACC）
- G 力（三轴加速度）

如需启用遥测叠加显示，在 `index.html` 中添加 `<script src="sei-telemetry.js"></script>` 并调用 `extractTelemetryFromMp4(file)`。

## 技术栈

- **前端**：纯 HTML/CSS/JavaScript，单文件，零依赖
- **地图**：Leaflet（CDN 加载，用于 GPS 轨迹显示）
- **车型**：Tesla Model 3/Y 行车记录仪格式

## 浏览器兼容性

Chrome / Edge 全功能支持（需要 File System Access API 选择文件夹）。

Firefox、Safari 支持单独选择视频文件播放。

手机端 Chrome / Safari 均可使用。

## 许可证

MIT
