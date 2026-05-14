#!/usr/bin/env bash
#
# ClawBench 开发调试启动脚本
#
# 用法:
#   ./dev-server.sh              # 后台启动 Vite HMR（代理到生产后端）
#   ./dev-server.sh --fg         # 前台启动
#   ./dev-server.sh --stop       # 停止 Vite
#   ./dev-server.sh --restart    # 重启 Vite
#
# 原理:
#   开发模式只启动 Vite 开发服务器（HMR 热更新），API 请求代理到已有的生产
#   后端（默认 20000 端口）。不启动独立的 Go 后端，不创建独立的数据库或配置，
#   与生产服务完全共享数据。
#

set -e

NAME="clawbench-dev"
VITE_PID_FILE="/tmp/${NAME}-vite.pid"
VITE_LOG="/tmp/vite-dev.log"

# Ports
BACKEND_PORT=${BACKEND_PORT:-20000}
FRONTEND_PORT=${VITE_FRONTEND_PORT:-20001}

# Load shared shell utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/scripts/common.sh"

# Check that the production backend is running on the expected port
check_backend() {
    local listening=""
    if command -v ss >/dev/null 2>&1; then
        listening=$(ss -tlnp 2>/dev/null | grep ":$BACKEND_PORT" | head -1)
    fi
    if [[ -z "$listening" ]]; then
        echo "WARNING: No backend detected on port $BACKEND_PORT." >&2
        echo "  Start the production server first: ./server.sh" >&2
        echo "" >&2
        read -p "  Start it now? [y/N] " -r
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ./server.sh
            sleep 1
        else
            echo "Aborted." >&2
            exit 1
        fi
    fi
}

show_auto_password() {
    local auto_pw_file=".clawbench/auto-password"
    if [[ -f "$auto_pw_file" ]]; then
        local pw
        pw=$(cat "$auto_pw_file")
        echo "  Password: $pw (auto-generated)"
    fi
}

_stop_vite() {
    if [[ -f "$VITE_PID_FILE" ]]; then
        local pid
        pid=$(cat "$VITE_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Stopping Vite (PID $pid)..."
            kill "$pid"
            sleep 0.5
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
        rm -f "$VITE_PID_FILE"
    fi

    # Fallback: kill by port
    local pids=""
    if command -v ss >/dev/null 2>&1; then
        pids=$(ss -tlnp 2>/dev/null | grep ":$FRONTEND_PORT" | grep -oP 'pid=\K[0-9]+' | sort -u | tr '\n' ' ')
    fi
    if [[ -n "$pids" ]]; then
        echo "Killing orphan process on port $FRONTEND_PORT (PIDs: $pids)..."
        echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
}

start_dev() {
    _stop_vite
    sleep 0.3

    check_backend

    echo "=== Starting $NAME (dev mode) ==="
    echo "  Backend:  http://localhost:$BACKEND_PORT (production)"
    echo "  Frontend: http://localhost:$FRONTEND_PORT (Vite HMR)"
    echo "  Shared:   .clawbench/"
    echo ""

    # Start Vite dev server — proxy to production backend
    VITE_BACKEND_PORT=$BACKEND_PORT VITE_FRONTEND_PORT=$FRONTEND_PORT nohup npx vite --port $FRONTEND_PORT > "$VITE_LOG" 2>&1 &
    echo $! > "$VITE_PID_FILE"

    sleep 1
    if ! kill -0 $(cat "$VITE_PID_FILE") 2>/dev/null; then
        echo "Failed to start Vite. Check $VITE_LOG" >&2
        rm -f "$VITE_PID_FILE"
        exit 1
    fi

    echo "Vite dev server started (PID $(cat "$VITE_PID_FILE")) on port $FRONTEND_PORT"
    echo ""

    show_auto_password
    echo "Open http://localhost:$FRONTEND_PORT in your browser"
    echo "Log: $VITE_LOG"
}

# Parse arguments
ACTION="start"
FOREGROUND=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --fg)
            FOREGROUND=1
            ;;
        --stop)
            ACTION=stop
            ;;
        --restart)
            ACTION=restart
            ;;
        --port)
            BACKEND_PORT="$2"
            shift
            ;;
        *)
            echo "未知参数: $1"
            echo "用法: $0 [--fg] [--stop] [--restart] [--port BACKEND_PORT]"
            exit 1
            ;;
    esac
    shift
done

case "$ACTION" in
    stop)
        echo "Stopping Vite..."
        _stop_vite
        echo "Done."
        ;;
    restart)
        echo "Restarting Vite..."
        _stop_vite
        sleep 1
        start_dev
        ;;
    start)
        if [[ -n "$FOREGROUND" ]]; then
            check_backend
            echo "=== Starting $NAME (dev mode, foreground) ==="
            echo "  Backend:  http://localhost:$BACKEND_PORT (production)"
            echo "  Frontend: http://localhost:$FRONTEND_PORT (Vite HMR)"
            echo ""
            VITE_BACKEND_PORT=$BACKEND_PORT VITE_FRONTEND_PORT=$FRONTEND_PORT exec npx vite --port $FRONTEND_PORT
        else
            start_dev
        fi
        ;;
esac
