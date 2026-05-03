# 五子棋联机对战

> 网页版五子棋，WebSocket 实时联机

## 功能

- **双人联机** — 两人在不同设备上通过浏览器对战
- **实时同步** — WebSocket 双向通信，落子即时显示
- **胜负判定** — 四方向扫描（横/竖/左斜/右斜），检测五连
- **房间匹配** — 快速匹配对手

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js |
| 通信 | WebSocket (ws) |
| 前端 | 原生 HTML + Canvas + JavaScript |
| 部署 | 局域网即可用 |

## 快速开始

```bash
npm install
npm start
```

打开 `http://localhost:8080`，另一设备访问 `http://<本机IP>:8080`

## 项目结构

```
gomoku-online/
├── package.json
├── server.js      # WebSocket 服务器 + 房间管理
└── gomoku.html    # 游戏界面（Canvas 棋盘）
```

## 玩法

黑子先行，五子连珠即胜。支持局域网内多组同时对战。
