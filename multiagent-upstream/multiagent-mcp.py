#!/usr/bin/env python3
"""MCP-сервер мультиагентского чата через WebFTP-шару.

Инструменты: chat_agents, chat_post, chat_dm, chat_read, chat_assign.
Транспорт: JSON-RPC по stdio (одна строка = одно сообщение).
"""
import json, os, sys, time, urllib.request, urllib.parse, uuid

SHARE = os.environ["WEBFTP_SHARE"].rstrip("/")

AGENTS = [
    {"id": "opencode-ling", "name": "OpenCode · Ling 3.2 Flash (free)", "model": "openrouter/inclusionai/ling-3.2-flash:free"},
    {"id": "opencode-gemma", "name": "OpenCode · Gemma 4 31B (free)", "model": "openrouter/google/gemma-4-31b-it:free"},
    {"id": "or-ling", "name": "OpenRouter · Ling 3.2 Flash (free)", "model": "inclusionai/ling-3.2-flash:free"},
    {"id": "or-ernie", "name": "OpenRouter · ERNIE 5.5 Flash (free)", "model": "baidu/ernie-5.5-flash-preview:free"},
    {"id": "or-nemotron-super", "name": "OpenRouter · Nemotron Super VL (free)", "model": "nvidia/nemotron-3.5-super-vl:free"},
    {"id": "or-nemotron-light", "name": "OpenRouter · Nemotron Lightning (free)", "model": "nvidia/nemotron-3.5-lightning:free"},
    {"id": "or-gemma-26", "name": "OpenRouter · Gemma 4 26B (free)", "model": "google/gemma-4-26b-a4b-it:free"},
    {"id": "or-gemma-31", "name": "OpenRouter · Gemma 4 31B (free)", "model": "google/gemma-4-31b-it:free"},
    {"id": "redot-cli", "name": "Redot CLI", "model": "redot / godot headless"},
    {"id": "chat-zai", "name": "chat.z.ai", "model": "облачный агент"},
]

TOOLS = [
    {"name": "chat_agents", "description": "Список агентов и моделей в мультиагентском чате.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "chat_post", "description": "Отправить сообщение в общую комнату агентов.", "inputSchema": {"type": "object", "properties": {"from": {"type": "string"}, "text": {"type": "string"}}, "required": ["from", "text"]}},
    {"name": "chat_dm", "description": "Отправить личное сообщение конкретному агенту.", "inputSchema": {"type": "object", "properties": {"from": {"type": "string"}, "to": {"type": "string"}, "text": {"type": "string"}}, "required": ["from", "to", "text"]}},
    {"name": "chat_read", "description": "Прочитать последние сообщения комнаты или ЛС.", "inputSchema": {"type": "object", "properties": {"scope": {"type": "string", "enum": ["room", "dm"]}, "me": {"type": "string"}, "with_agent": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["scope"]}},
    {"name": "chat_assign", "description": "Назначить задачу агенту (пишет assign-*.json и task-*.json).", "inputSchema": {"type": "object", "properties": {"agent": {"type": "string"}, "method": {"type": "string"}, "params": {"type": "object"}, "from": {"type": "string"}}, "required": ["agent", "method"]}},
]


def put(name, obj):
    url = SHARE + "/?name=" + urllib.parse.quote(name)
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="PUT", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200
    except Exception:
        return False


def get(name):
    try:
        with urllib.request.urlopen(SHARE + "/" + urllib.parse.quote(name) + "?view=1", timeout=15) as r:
            return r.read().decode("utf-8", "ignore")
    except Exception:
        return None


def listing():
    try:
        with urllib.request.urlopen(SHARE + "/?json=1", timeout=30) as r:
            j = json.loads(r.read().decode("utf-8", "ignore"))
            return [i.get("name", "") for i in j.get("items", []) if i.get("type") == "file"]
    except Exception:
        return []


def stamp():
    return time.strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:5]




def fix_moji(s):
    """Восстановить кириллицу, если текст пришёл как UTF-8, прочитанный как CP1251."""
    if not isinstance(s, str) or not s:
        return s
    try:
        fixed = s.encode("cp1251").decode("utf-8")
    except Exception:
        return s
    # эвристика: типичные пары мódжaibe ("Рё", "Ри", "СЂ" и т.п.)
    import re
    if re.search(r"[РС][ЁЂЃЄЅІЇЈЉЊЋЌЍЎЏёђѓєѕіїјљњћќѝўџ]", s):
        return fixed
    return s




def index_add(name):
    raw = get("chat-index.json") or "[]"
    try:
        arr = json.loads(raw)
        if not isinstance(arr, list): arr = []
    except Exception:
        arr = []
    if name not in arr:
        arr.append(name)
    put("chat-index.json", arr[-500:])


def call(name, args):
    a = args or {}
    if name == "chat_agents":
        return {"agents": AGENTS}
    if name == "chat_post":
        n = "chat-" + stamp() + ".json"
        msg = {"from": fix_moji(a.get("from", "agent")), "text": fix_moji(a.get("text", "")), "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        ok=put(n,msg); index_add(n); return {"ok": ok, "file": n}
    if name == "chat_dm":
        f, t = a.get("from", "agent"), a.get("to", "")
        n = "dm-%s-%s-%s.json" % (f, t, stamp())
        msg = {"from": fix_moji(f), "to": fix_moji(t), "text": fix_moji(a.get("text", "")), "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        ok=put(n,msg); index_add(n); return {"ok": ok, "file": n}
    if name == "chat_read":
        scope = a.get("scope", "room")
        pref = "chat-" if scope == "room" else "dm-"
        limit = int(a.get("limit", 30))
        me, other = a.get("me", ""), a.get("with_agent", "")
        out = []
        for n in [x for x in listing() if x.startswith(pref)][-limit:]:
            raw = get(n)
            if not raw:
                continue
            try:
                m = json.loads(raw)
            except Exception:
                continue
            if scope == "dm" and me and other:
                if not ((m.get("from") == me and m.get("to") == other) or (m.get("from") == other and m.get("to") == me)):
                    continue
            out.append(m)
        out.sort(key=lambda m: m.get("ts", ""))
        return {"messages": out}
    if name == "chat_assign":
        ident = "as" + stamp()
        agent, method = a.get("agent", ""), a.get("method", "")
        params = a.get("params", {})
        frm = a.get("from", "agent")
        ok1 = put("assign-" + ident + ".json", {"id": ident, "agent": agent, "method": method, "params": params, "from": frm, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        ok2 = put("task-" + ident + ".json", {"jsonrpc": "2.0", "id": ident, "method": method, "params": params, "agent": agent})
        return {"ok": ok1 and ok2, "id": ident, "agent": agent}
    raise ValueError("unknown tool " + str(name))


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        method, rid = req.get("method"), req.get("id")
        if method == "initialize":
            res = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "multiagent-chat", "version": "1.0"}}
        elif method == "tools/list":
            res = {"tools": TOOLS}
        elif method == "tools/call":
            p = req.get("params", {})
            try:
                out = call(p.get("name"), p.get("arguments", {}))
                res = {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}]}
            except Exception as e:
                res = {"content": [{"type": "text", "text": json.dumps({"error": str(e)}, ensure_ascii=False)}], "isError": True}
        elif method in ("notifications/initialized", "initialized"):
            continue
        else:
            res = {"error": {"code": -32601, "message": "Method not found"}}
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": rid, "result": res}, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
