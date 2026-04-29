const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const BOARD_SIZE = 15;

// 读取 HTML 文件
const htmlPath = path.join(__dirname, 'gomoku.html');
let htmlContent;
try {
  htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  console.log(`[服务] 已加载 HTML 文件`);
} catch (e) {
  console.error(`[错误] 无法读取 gomoku.html: ${e.message}`);
  process.exit(1);
}

// ========== 房间管理 ==========
const rooms = new Map();

function generateRoomId() {
  while (true) {
    const id = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(id)) return id;
  }
}

function createEmptyBoard() {
  return Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
}

function checkWin(board, row, col, player) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    let sr = row, sc = col, er = row, ec = col;
    for (let i = 1; i < 5; i++) {
      const nr = row + dr * i, nc = col + dc * i;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
      if (board[nr][nc] !== player) break;
      count++; er = nr; ec = nc;
    }
    for (let i = 1; i < 5; i++) {
      const nr = row - dr * i, nc = col - dc * i;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
      if (board[nr][nc] !== player) break;
      count++; sr = nr; sc = nc;
    }
    if (count >= 5) return [sr, sc, er, ec];
  }
  return null;
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, excludeIndex = -1) {
  room.players.forEach((p, i) => {
    if (i !== excludeIndex && p) send(p, data);
  });
}

// ========== HTTP 服务器 ==========
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlContent);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// ========== WebSocket 服务器 ==========
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const clientAddr = req.socket.remoteAddress;
  console.log(`[连接] ${clientAddr} (在线: ${wss.clients.size})`);
  let currentRoomId = null;
  let playerIndex = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'create_room': {
        if (currentRoomId) { send(ws, { type: 'error', message: '已在房间中' }); return; }
        const roomId = generateRoomId();
        const room = {
          id: roomId,
          players: [ws, null],
          colors: ['black', 'white'],
          board: createEmptyBoard(),
          currentPlayer: 'black',
          gameOver: false,
          moveHistory: [],
          winLine: null,
        };
        rooms.set(roomId, room);
        currentRoomId = roomId;
        playerIndex = 0;
        console.log(`[房间] ${roomId} 创建 (房间数: ${rooms.size})`);
        send(ws, { type: 'room_created', roomId });
        break;
      }

      case 'join_room': {
        if (currentRoomId) { send(ws, { type: 'error', message: '已在房间中' }); return; }
        const { roomId } = msg;
        const room = rooms.get(roomId);
        if (!room) { send(ws, { type: 'error', message: '房间不存在' }); return; }
        if (room.players[1]) { send(ws, { type: 'error', message: '房间已满' }); return; }

        room.players[1] = ws;
        currentRoomId = roomId;
        playerIndex = 1;

        console.log(`[房间] ${roomId} 玩家2加入`);

        send(ws, { type: 'room_joined', roomId, yourColor: 'white' });
        send(room.players[0], { type: 'opponent_joined', yourColor: 'black' });

        // 同步已有棋盘状态
        for (const [r, c, p] of room.moveHistory) {
          send(ws, { type: 'move_made', row: r, col: c, color: p });
        }
        break;
      }

      case 'place_piece': {
        const room = rooms.get(currentRoomId);
        if (!room) { send(ws, { type: 'error', message: '房间不存在' }); return; }
        if (room.gameOver) { send(ws, { type: 'error', message: '游戏已结束' }); return; }
        if (room.players[playerIndex] !== ws) { send(ws, { type: 'error', message: '你不是该房间玩家' }); return; }
        if (room.currentPlayer !== room.colors[playerIndex]) { send(ws, { type: 'error', message: '还没到你' }); return; }

        const { row, col } = msg;
        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) { send(ws, { type: 'error', message: '超出棋盘' }); return; }
        if (room.board[row][col] !== null) { send(ws, { type: 'error', message: '已有棋子' }); return; }

        const color = room.colors[playerIndex];
        room.board[row][col] = color;
        room.moveHistory.push([row, col, color]);

        broadcast(room, { type: 'move_made', row, col, color });

        const winLine = checkWin(room.board, row, col, color);
        if (winLine) {
          room.gameOver = true;
          room.winLine = winLine;
          broadcast(room, { type: 'game_over', winner: color, winLine });
          console.log(`[房间] ${currentRoomId} ${color} 胜利`);
        } else if (room.moveHistory.length === BOARD_SIZE * BOARD_SIZE) {
          room.gameOver = true;
          broadcast(room, { type: 'game_over', winner: 'draw', winLine: null });
        } else {
          room.currentPlayer = room.currentPlayer === 'black' ? 'white' : 'black';
        }
        break;
      }

      case 'reset_game': {
        const room = rooms.get(currentRoomId);
        if (!room) return;
        room.board = createEmptyBoard();
        room.currentPlayer = 'black';
        room.gameOver = false;
        room.moveHistory = [];
        room.winLine = null;
        broadcast(room, { type: 'room_reset' });
        console.log(`[房间] ${currentRoomId} 重置`);
        break;
      }

      case 'chat': {
        const room = rooms.get(currentRoomId);
        if (!room) return;
        const name = playerIndex === 0 ? '黑棋' : '白棋';
        broadcast(room, { type: 'chat', message: msg.message, from: name }, playerIndex);
        break;
      }

      default: break;
    }
  });

  ws.on('close', () => {
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        const otherIndex = playerIndex === 0 ? 1 : 0;
        const other = room.players[otherIndex];
        if (other) send(other, { type: 'opponent_disconnected' });
        rooms.delete(currentRoomId);
        console.log(`[房间] ${currentRoomId} 关闭`);
      }
    }
    console.log(`[断开] ${clientAddr} (在线: ${wss.clients.size - 1})`);
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║       五子棋联机服务器已启动              ║
  ║                                          ║
  ║   地址: http://localhost:${PORT}             ║
  ║                                          ║
  ║   让别人访问:                             ║
  ║   ngrok http ${PORT}                        ║
  ║   然后分享 ngrok 给的网址即可              ║
  ║                                          ║
  ║   局域网: http://本机IP:${PORT}             ║
  ╚══════════════════════════════════════════╝
  `);
});
