#!/usr/bin/env bash
#
# ClawBench 正式版启动脚本
#
# 用法:
#   ./server.sh              # 后台启动
#   ./server.sh --fg         # 前台启动
#   ./server.sh --stop       # 停止所有运行实例
#   ./server.sh --restart    # 重启
#

NAME="clawbench"
BIN="./$NAME"
CONFIG="config/config.yaml"
AUTO_PW_FILE=".clawbench/auto-password"

RELEASE_PORT=20000

# --- Inline utility functions (from scripts/common.sh) ---

# Read watch_dir from config file; returns empty string if not found.
get_watch_dir() {
    local config="$1"
    grep "^watch_dir:" "$config" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo ""
}

# Print auto-generated password if the file exists.
show_auto_password() {
    local auto_pw_file="$1"
    if [[ -f "$auto_pw_file" ]]; then
        local pw
        pw=$(cat "$auto_pw_file")
        echo "  Password: $pw (auto-generated, saved in $auto_pw_file)"
    fi
}

# Ensure the Go binary exists; build it if missing.
check_binary() {
    local bin="$1"
    if [[ ! -f "$bin" ]]; then
        echo "Binary not found, building..."
        if command -v go >/dev/null 2>&1; then
            go build -o "$bin" ./cmd/server
        else
            echo "Error: Go not found and binary missing." >&2
            exit 1
        fi
    fi
}

# Stop processes by PID file and/or port.
_stop_servers() {
    local pid_file="$1"
    local port="$2"
    local name="${3:-server}"

    if [[ -n "$pid_file" && -f "$pid_file" ]]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Stopping $name (PID $pid)..."
            kill "$pid"
            sleep 1
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null
                sleep 1
            fi
        fi
        rm -f "$pid_file"
    fi

    if [[ -n "$port" ]]; then
        local pids=""
        if command -v ss >/dev/null 2>&1; then
            pids=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | sort -u | tr '\n' ' ')
        elif command -v netstat >/dev/null 2>&1; then
            pids=$(netstat -tlnp 2>/dev/null | grep ":$port " | grep -oP '\s[0-9]+/' | grep -oP '[0-9]+' | sort -u | tr '\n' ' ')
        fi
        if [[ -n "$pids" ]]; then
            echo "Killing orphan process on port $port (PIDs: $pids)..."
            echo "$pids" | xargs kill 2>/dev/null || true
            sleep 1
            if command -v ss >/dev/null 2>&1; then
                local remaining
                remaining=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | sort -u | tr '\n' ' ')
                if [[ -n "$remaining" ]]; then
                    echo "$remaining" | xargs kill -9 2>/dev/null || true
                    sleep 1
                fi
            fi
        fi

        local waited=0
        while [[ $waited -lt 5 ]]; do
            local bound=""
            if command -v ss >/dev/null 2>&1; then
                bound=$(ss -tlnp 2>/dev/null | grep ":$port ") || true
            fi
            if [[ -z "$bound" ]]; then
                break
            fi
            sleep 0.5
            waited=$((waited + 1))
        done
    fi
}

# --- End inline utilities ---

# PID and LOG files — default port uses legacy paths for backward compat.
if [[ -n "$PORT" && "$PORT" != "$RELEASE_PORT" ]]; then
    PID_FILE="/tmp/${NAME}-${PORT}.pid"
    LOG_FILE="/tmp/${NAME}-${PORT}.log"
else
    PID_FILE="/tmp/${NAME}.pid"
    LOG_FILE="/tmp/${NAME}-release.log"
fi

# Stop ALL running clawbench instances by scanning PID files.
_stop_release() {
    local found=0
    for pf in /tmp/${NAME}.pid /tmp/${NAME}-*.pid; do
        [[ -f "$pf" ]] || continue
        local pid
        pid=$(cat "$pf")
        if kill -0 "$pid" 2>/dev/null; then
            local port
            if [[ "$pf" == "/tmp/${NAME}.pid" ]]; then
                port=$RELEASE_PORT
            else
                port=$(basename "$pf" | sed "s/${NAME}-//;s/\.pid//")
            fi
            echo "Stopping $NAME on port $port (PID $pid)..."
            _stop_servers "$pf" "$port" "release backend"
            found=1
        else
            rm -f "$pf"
        fi
    done

    if [[ $found -eq 0 ]]; then
        echo "No running $NAME instances found."
    fi

    # Clear stale DuckDB lock files to resolve RAG lock conflicts
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local lock_file="$SCRIPT_DIR/.clawbench/rag.duckdb"
    if [[ -f "${lock_file}.lock" ]]; then
        echo "Removing stale DuckDB lock..."
        rm -f "${lock_file}.lock"
    fi
}

start_release() {
    _stop_release
    sleep 0.3

    check_binary "$BIN"

    local WATCH_DIR
    WATCH_DIR=$(get_watch_dir "$CONFIG")
    echo "=== Starting $NAME (release) ==="
    echo "  Binary:   $BIN"
    echo "  Config:   $CONFIG"
    echo "  Port:     ${PORT:-$RELEASE_PORT}"
    echo "  Watch:    ${WATCH_DIR:-default}"
    echo "  PIDFile:  $PID_FILE"
    echo "  Log:      $LOG_FILE"
    show_auto_password "$AUTO_PW_FILE"
    echo ""

    if [[ -n "$FOREGROUND" ]]; then
        echo "Open http://localhost:${PORT:-$RELEASE_PORT} in your browser"
        echo ""
        if [[ -n "$PORT" ]]; then
            PORT=$PORT exec "$BIN"
        else
            exec "$BIN"
        fi
    else
        if [[ -n "$PORT" ]]; then
            PORT=$PORT nohup $BIN >> "$LOG_FILE" 2>&1 &
        else
            nohup $BIN >> "$LOG_FILE" 2>&1 &
        fi
        echo $! > "$PID_FILE"
        disown $! 2>/dev/null

        sleep 0.5
        if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
            echo "Started (PID $(cat "$PID_FILE")) on port ${PORT:-$RELEASE_PORT}"
            echo "Log: $LOG_FILE"
        else
            echo "Failed to start." >&2
            rm -f "$PID_FILE"
            exit 1
        fi
    fi
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
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
    shift
done

case "$ACTION" in
    stop)
        _stop_release
        echo "Done."
        ;;
    restart)
        _stop_release
        sleep 1
        start_release
        ;;
    start)
        start_release
        ;;
esac
